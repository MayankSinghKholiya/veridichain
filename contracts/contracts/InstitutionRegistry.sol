// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IQIEPass.sol";
import "./IQIEDex.sol";

/// @title InstitutionRegistry
/// @notice Manages verified institution registration with QIE Pass + Stable Coin staking
/// @dev UUPS upgradeable proxy pattern for future-proofing
contract InstitutionRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    // ─── QIE Ecosystem contracts ───────────────────────────────────────────
    IQIEPass   public qiePass;
    IERC20     public qieStableCoin;
    IQIEDex    public qieDex;
    address    public qieTokenAddress;  // native QIE token for DEX pair

    // ─── Config ────────────────────────────────────────────────────────────
    uint256 public STAKE_AMOUNT;        // QIEUSD required to register
    address public TREASURY;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ─── Data structures ───────────────────────────────────────────────────
    struct Institution {
        string  name;
        string  domain;           // e.g. "mit.edu" — used for DNS proof
        string  country;
        string  website;
        string  passportDID;      // QIE Pass DID
        uint256 stakedAmount;     // QIEUSD locked
        uint256 registeredAt;
        bool    isVerified;       // admin approved
        bool    isSlashed;
    }

    mapping(address => Institution) public institutions;
    mapping(string => address)      public domainToAddress;  // domain uniqueness
    address[]                       public institutionList;

    // ─── Events ────────────────────────────────────────────────────────────
    event InstitutionRegistered(address indexed institution, string name, string domain, string passportDID);
    event InstitutionVerified(address indexed institution, address indexed admin);
    event InstitutionSlashed(address indexed institution, uint256 amount, string reason);
    event InstitutionRevoked(address indexed institution, string reason);
    event StakeWithdrawn(address indexed institution, uint256 amount);

    // ─── Modifiers ─────────────────────────────────────────────────────────

    /// @notice Requires caller to hold a valid QIE Pass — CORE QIE integration
    modifier requiresQIEPass() {
        require(
            address(qiePass) == address(0) || qiePass.hasValidPass(msg.sender),
            "QIE Pass required to register as institution"
        );
        _;
    }

    modifier onlyVerifiedInstitution() {
        require(institutions[msg.sender].isVerified, "Not a verified institution");
        require(!institutions[msg.sender].isSlashed, "Institution is slashed");
        _;
    }

    // ─── Initializer ───────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _qiePass,
        address _qieStableCoin,
        address _qieDex,
        address _qieToken,
        address _treasury,
        uint256 _stakeAmount
    ) public initializer {
        __Ownable_init();

        qiePass        = IQIEPass(_qiePass);
        qieStableCoin  = IERC20(_qieStableCoin);
        qieDex         = IQIEDex(_qieDex);
        qieTokenAddress = _qieToken;
        TREASURY       = _treasury;
        STAKE_AMOUNT   = _stakeAmount;
    }

    // ─── Registration ──────────────────────────────────────────────────────

    /// @notice Register as an institution — requires QIE Pass + QIEUSD stake
    function registerInstitution(
        string calldata _name,
        string calldata _domain,
        string calldata _country,
        string calldata _website
    ) external requiresQIEPass {
        require(bytes(institutions[msg.sender].name).length == 0, "Already registered");
        require(domainToAddress[_domain] == address(0), "Domain already registered");
        require(bytes(_name).length > 0, "Name required");
        require(bytes(_domain).length > 0, "Domain required");

        // Pull QIEUSD stake from institution wallet — CORE QIE Stable Coin use
        if (STAKE_AMOUNT > 0) {
            require(
                qieStableCoin.transferFrom(msg.sender, address(this), STAKE_AMOUNT),
                "Stake transfer failed - approve QIEUSD first"
            );
        }

        // Get QIE Pass DID if available
        string memory did = "";
        if (address(qiePass) != address(0)) {
            try qiePass.getDID(msg.sender) returns (string memory _did) {
                did = _did;
            } catch {}
        }

        institutions[msg.sender] = Institution({
            name:          _name,
            domain:        _domain,
            country:       _country,
            website:       _website,
            passportDID:   did,
            stakedAmount:  STAKE_AMOUNT,
            registeredAt:  block.timestamp,
            isVerified:    false,   // admin must approve
            isSlashed:     false
        });

        domainToAddress[_domain] = msg.sender;
        institutionList.push(msg.sender);

        emit InstitutionRegistered(msg.sender, _name, _domain, did);
    }

    // ─── Admin functions ───────────────────────────────────────────────────

    /// @notice Admin approves an institution after off-chain DNS + document check
    function verifyInstitution(address _institution) external onlyOwner {
        require(bytes(institutions[_institution].name).length > 0, "Not registered");
        require(!institutions[_institution].isVerified, "Already verified");
        institutions[_institution].isVerified = true;
        emit InstitutionVerified(_institution, msg.sender);
    }

    /// @notice Slash a fraudulent institution — CORE QIE Stable Coin + DEX integration
    function slashInstitution(
        address _institution,
        string calldata _reason
    ) external onlyOwner {
        Institution storage inst = institutions[_institution];
        require(inst.isVerified, "Not verified");
        require(!inst.isSlashed, "Already slashed");

        uint256 stake = inst.stakedAmount;
        inst.isSlashed = true;
        inst.stakedAmount = 0;

        uint256 toBurn      = stake / 2;
        uint256 toTreasury  = stake - toBurn;

        // Burn 50% — permanent removal from supply
        if (toBurn > 0) {
            qieStableCoin.transfer(DEAD_ADDRESS, toBurn);
        }

        // Send 50% to treasury, then auto-add to QIE DEX liquidity
        if (toTreasury > 0) {
            _addToLiquidity(toTreasury);
        }

        emit InstitutionSlashed(_institution, stake, _reason);
    }

    // ─── Internal: DEX liquidity ───────────────────────────────────────────

    /// @notice Auto-add slashed QIEUSD to QIE DEX liquidity — CORE QIE DEX integration
    function _addToLiquidity(uint256 amount) internal {
        if (address(qieDex) == address(0) || qieTokenAddress == address(0)) {
            // Fallback: just send to treasury if DEX not configured
            qieStableCoin.transfer(TREASURY, amount);
            return;
        }
        qieStableCoin.approve(address(qieDex), amount);
        try qieDex.addLiquidity(
            address(qieStableCoin),
            qieTokenAddress,
            amount,
            0,
            TREASURY
        ) {
            // Liquidity added successfully
        } catch {
            // Fallback to treasury if DEX call fails
            qieStableCoin.transfer(TREASURY, amount);
        }
    }

    // ─── Views ─────────────────────────────────────────────────────────────

    function isVerified(address _institution) external view returns (bool) {
        return institutions[_institution].isVerified && !institutions[_institution].isSlashed;
    }

    function getInstitution(address _institution) external view returns (Institution memory) {
        return institutions[_institution];
    }

    function getAllInstitutions() external view returns (address[] memory) {
        return institutionList;
    }

    function getTotalInstitutions() external view returns (uint256) {
        return institutionList.length;
    }

    // ─── Stake withdrawal ──────────────────────────────────────────────────

    /// @notice Institution can withdraw stake after 30 days notice (after leaving)
    function withdrawStake() external onlyVerifiedInstitution {
        Institution storage inst = institutions[msg.sender];
        require(
            block.timestamp >= inst.registeredAt + 30 days,
            "30 day lock period active"
        );
        uint256 amount = inst.stakedAmount;
        inst.stakedAmount = 0;
        inst.isVerified = false;
        qieStableCoin.transfer(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount);
    }

    // ─── Admin setters (for testnet / post-deploy fixes) ──────────────────
    /// @notice Update the QIEUSD stake amount required for registration.
    ///         Set to 0 on testnet where stablecoin is not yet deployed.
    function setStakeAmount(uint256 _amount) external onlyOwner {
        STAKE_AMOUNT = _amount;
    }

    /// @notice Update the QIEUSD stablecoin address (for when it is deployed).
    function setQieStableCoin(address _addr) external onlyOwner {
        qieStableCoin = IERC20(_addr);
    }

    // ─── UUPS upgrade authorization ────────────────────────────────────────
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
