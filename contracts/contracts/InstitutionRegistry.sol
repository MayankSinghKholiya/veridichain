// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IQIEPass.sol";
import "./IQIEDex.sol";

contract InstitutionRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    // Storage order is fixed — UUPS upgrade layout, never reorder these
    IQIEPass   public qiePass;
    IERC20     public qieStableCoin;   // QUSDC
    IQIEDex    public qieDex;
    address    public qieTokenAddress;

    uint256 public STAKE_AMOUNT;
    address public TREASURY;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct Institution {
        string  name;
        string  domain;
        string  country;
        string  website;
        string  passportDID;
        uint256 stakedAmount;   // deprecated — was QUSDC stake, always 0 now
        uint256 registeredAt;
        bool    isVerified;
        bool    isSlashed;
    }

    mapping(address => Institution) public institutions;
    mapping(string => address)      public domainToAddress;
    address[]                       public institutionList;

    event InstitutionRegistered(address indexed institution, string name, string domain, string passportDID);
    event InstitutionVerified(address indexed institution, address indexed admin);
    event InstitutionRejected(address indexed institution, uint256 stakeReturned);
    event InstitutionRevoked(address indexed institution, string reason, uint256 stakeReturned);
    event InstitutionSlashed(address indexed institution, uint256 amount, string reason);
    event StakeWithdrawn(address indexed institution, uint256 amount);

    // v2 additions — appended after original slots to preserve upgrade layout
    IERC20  public wqieToken;
    uint256 public REGISTRATION_FEE;
    mapping(address => uint256) public wqieStaked;

    // v3 additions
    // Admins can verify/reject/revoke but NOT slash — slash is owner-only because it burns funds
    mapping(address => bool) public institutionAdmins;

    modifier requiresQIEPass() {
        require(
            address(qiePass) == address(0) || qiePass.hasValidPass(msg.sender),
            "QIE Pass required to register as institution"
        );
        _;
    }

    modifier onlyOwnerOrAdmin() {
        require(
            msg.sender == owner() || institutionAdmins[msg.sender],
            "Not authorized: owner or admin required"
        );
        _;
    }

    modifier onlyVerifiedInstitution() {
        require(institutions[msg.sender].isVerified, "Not a verified institution");
        require(!institutions[msg.sender].isSlashed, "Institution is slashed");
        _;
    }

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
        __UUPSUpgradeable_init();

        qiePass         = IQIEPass(_qiePass);
        qieStableCoin   = IERC20(_qieStableCoin);
        qieDex          = IQIEDex(_qieDex);
        qieTokenAddress = _qieToken;
        TREASURY        = _treasury;
        STAKE_AMOUNT    = _stakeAmount;
    }

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

        if (REGISTRATION_FEE > 0 && address(qieStableCoin) != address(0)) {
            require(
                qieStableCoin.transferFrom(msg.sender, TREASURY, REGISTRATION_FEE),
                "QUSDC fee transfer failed - approve QUSDC first"
            );
        }

        if (STAKE_AMOUNT > 0 && address(wqieToken) != address(0)) {
            require(
                wqieToken.transferFrom(msg.sender, address(this), STAKE_AMOUNT),
                "WQIE stake transfer failed - approve WQIE first"
            );
            wqieStaked[msg.sender] = STAKE_AMOUNT;
        }

        string memory did = "";
        if (address(qiePass) != address(0)) {
            try qiePass.getDID(msg.sender) returns (string memory _did) {
                did = _did;
            } catch {}
        }

        institutions[msg.sender] = Institution({
            name:         _name,
            domain:       _domain,
            country:      _country,
            website:      _website,
            passportDID:  did,
            stakedAmount: 0,
            registeredAt: block.timestamp,
            isVerified:   false,
            isSlashed:    false
        });

        domainToAddress[_domain] = msg.sender;
        institutionList.push(msg.sender);

        emit InstitutionRegistered(msg.sender, _name, _domain, did);
    }

    function verifyInstitution(address _institution) external onlyOwnerOrAdmin {
        require(bytes(institutions[_institution].name).length > 0, "Not registered");
        require(!institutions[_institution].isVerified, "Already verified");
        institutions[_institution].isVerified = true;
        emit InstitutionVerified(_institution, msg.sender);
    }

    function rejectInstitution(address _institution) external onlyOwnerOrAdmin {
        require(bytes(institutions[_institution].name).length > 0, "Not registered");
        require(!institutions[_institution].isVerified, "Already verified - use revokeInstitution");
        require(!institutions[_institution].isSlashed, "Already slashed");

        uint256 stake = wqieStaked[_institution];
        if (stake > 0 && address(wqieToken) != address(0)) {
            wqieStaked[_institution] = 0;
            require(wqieToken.transfer(_institution, stake), "WQIE return failed");
        }

        domainToAddress[institutions[_institution].domain] = address(0);
        delete institutions[_institution];
        _removeFromList(_institution);

        emit InstitutionRejected(_institution, stake);
    }

    // Non-punitive removal — stake is returned in full. Use slashInstitution() for fraud.
    function revokeInstitution(address _institution, string calldata _reason) external onlyOwnerOrAdmin {
        require(institutions[_institution].isVerified, "Not a verified institution");
        require(!institutions[_institution].isSlashed, "Already slashed");

        uint256 stake = wqieStaked[_institution];
        if (stake > 0 && address(wqieToken) != address(0)) {
            wqieStaked[_institution] = 0;
            require(wqieToken.transfer(_institution, stake), "WQIE return failed");
        }

        institutions[_institution].isVerified = false;
        emit InstitutionRevoked(_institution, _reason, stake);
    }

    function slashInstitution(
        address _institution,
        string calldata _reason
    ) external onlyOwner {
        Institution storage inst = institutions[_institution];
        require(bytes(inst.name).length > 0, "Not registered");
        require(!inst.isSlashed, "Already slashed");

        uint256 stake = wqieStaked[_institution];
        inst.isSlashed    = true;
        inst.isVerified   = false;
        wqieStaked[_institution] = 0;

        if (stake > 0 && address(wqieToken) != address(0)) {
            uint256 toBurn     = stake / 2;
            uint256 toTreasury = stake - toBurn;

            if (toBurn > 0) {
                wqieToken.transfer(DEAD_ADDRESS, toBurn);
            }
            if (toTreasury > 0) {
                _addToLiquidity(toTreasury);
            }
        }

        emit InstitutionSlashed(_institution, stake, _reason);
    }

    function withdrawStake() external {
        Institution storage inst = institutions[msg.sender];
        require(bytes(inst.name).length > 0, "Not registered");
        require(!inst.isSlashed, "Slashed institutions cannot withdraw");

        uint256 stake = wqieStaked[msg.sender];
        require(stake > 0, "No WQIE stake to withdraw");

        wqieStaked[msg.sender] = 0;
        inst.isVerified = false;

        require(wqieToken.transfer(msg.sender, stake), "WQIE return failed");
        emit StakeWithdrawn(msg.sender, stake);
    }

    function _addToLiquidity(uint256 amount) internal {
        if (address(qieDex) == address(0) || address(qieStableCoin) == address(0)) {
            wqieToken.transfer(TREASURY, amount);
            return;
        }
        wqieToken.approve(address(qieDex), amount);
        try qieDex.addLiquidity(
            address(wqieToken),
            address(qieStableCoin),
            amount,
            0,
            0,
            0,
            TREASURY,
            block.timestamp + 300
        ) {
            // added to pool
        } catch {
            // DEX call failed, send to treasury
            wqieToken.transfer(TREASURY, amount);
        }
    }

    function _removeFromList(address _institution) internal {
        uint256 len = institutionList.length;
        for (uint256 i = 0; i < len; i++) {
            if (institutionList[i] == _institution) {
                institutionList[i] = institutionList[len - 1];
                institutionList.pop();
                break;
            }
        }
    }

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

    function getWqieStake(address _institution) external view returns (uint256) {
        return wqieStaked[_institution];
    }

    function setStakeAmount(uint256 _amount) external onlyOwner { STAKE_AMOUNT = _amount; }
    function setRegistrationFee(uint256 _fee) external onlyOwner { REGISTRATION_FEE = _fee; }
    function setWqieToken(address _wqie) external onlyOwner { wqieToken = IERC20(_wqie); }
    function setQieStableCoin(address _addr) external onlyOwner { qieStableCoin = IERC20(_addr); }
    function setQieDex(address _dex) external onlyOwner { qieDex = IQIEDex(_dex); }
    function setTreasury(address _treasury) external onlyOwner { TREASURY = _treasury; }

    function addInstitutionAdmin(address _admin) external onlyOwner { institutionAdmins[_admin] = true; }
    function removeInstitutionAdmin(address _admin) external onlyOwner { institutionAdmins[_admin] = false; }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
