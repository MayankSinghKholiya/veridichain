// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./InstitutionRegistry.sol";
import "./CredentialNFT.sol";

contract CredentialRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    InstitutionRegistry public institutionRegistry;
    CredentialNFT       public credentialNFT;

    enum Tier { NONE, INSTITUTION_VERIFIED, SELF_ATTESTED }

    struct Credential {
        bytes32 credentialHash;     // keccak256 of encrypted JSON blob
        string  ipfsCID;
        address issuer;
        string  issuerPassDID;
        address candidate;
        string  candidatePassDID;
        Tier    tier;
        uint256 issuedAt;
        bool    isRevoked;
        string  revokeReason;
        uint256 nftTokenId;
    }

    mapping(bytes32 => Credential) public credentials;
    mapping(address => bytes32[])  public candidateCredentials;
    bytes32[]                      public allCredentialIds;

    event CredentialIssued(
        bytes32 indexed credentialId,
        address indexed issuer,
        address indexed candidate,
        bytes32 credentialHash,
        Tier tier,
        uint256 timestamp
    );
    event CredentialRevoked(
        bytes32 indexed credentialId,
        address indexed revokedBy,
        string reason,
        uint256 timestamp
    );
    event CredentialUpgraded(
        bytes32 indexed credentialId,
        address indexed institution,
        uint256 timestamp
    );
    event CredentialReissued(
        bytes32 indexed oldCredentialId,
        bytes32 indexed newCredentialId,
        address indexed newWallet
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _institutionRegistry,
        address _credentialNFT
    ) public initializer {
        __Ownable_init();
        institutionRegistry = InstitutionRegistry(_institutionRegistry);
        credentialNFT       = CredentialNFT(_credentialNFT);
    }

    function issueCredential(
        address _candidate,
        bytes32 _credentialHash,
        string calldata _ipfsCID,
        string calldata _candidatePassDID
    ) external returns (bytes32 credentialId) {
        require(
            institutionRegistry.isVerified(msg.sender),
            "Caller is not a verified institution"
        );
        require(_candidate != address(0), "Invalid candidate address");
        require(_credentialHash != bytes32(0), "Invalid credential hash");
        require(bytes(_ipfsCID).length > 0, "IPFS CID required");

        string memory issuerDID = "";
        IQIEPass _qiePass = institutionRegistry.qiePass();
        if (address(_qiePass) != address(0)) {
            try _qiePass.getDID(msg.sender) returns (string memory did) {
                issuerDID = did;
            } catch {}
        }

        credentialId = _generateCredentialId(_credentialHash, msg.sender, _candidate);
        require(credentials[credentialId].issuedAt == 0, "Credential already exists");

        uint256 tokenId = credentialNFT.mintCredential(
            _candidate,
            credentialId,
            _ipfsCID,
            uint8(Tier.INSTITUTION_VERIFIED)
        );

        credentials[credentialId] = Credential({
            credentialHash:   _credentialHash,
            ipfsCID:          _ipfsCID,
            issuer:           msg.sender,
            issuerPassDID:    issuerDID,
            candidate:        _candidate,
            candidatePassDID: _candidatePassDID,
            tier:             Tier.INSTITUTION_VERIFIED,
            issuedAt:         block.timestamp,
            isRevoked:        false,
            revokeReason:     "",
            nftTokenId:       tokenId
        });

        candidateCredentials[_candidate].push(credentialId);
        allCredentialIds.push(credentialId);

        emit CredentialIssued(
            credentialId, msg.sender, _candidate,
            _credentialHash, Tier.INSTITUTION_VERIFIED, block.timestamp
        );
    }

    function selfAttestCredential(
        bytes32 _credentialHash,
        string calldata _ipfsCID,
        string calldata _candidatePassDID
    ) external returns (bytes32 credentialId) {
        require(_credentialHash != bytes32(0), "Invalid hash");
        require(bytes(_ipfsCID).length > 0, "IPFS CID required");

        credentialId = _generateCredentialId(_credentialHash, msg.sender, msg.sender);
        require(credentials[credentialId].issuedAt == 0, "Already attested");

        uint256 tokenId = credentialNFT.mintCredential(
            msg.sender,
            credentialId,
            _ipfsCID,
            uint8(Tier.SELF_ATTESTED)
        );

        credentials[credentialId] = Credential({
            credentialHash:   _credentialHash,
            ipfsCID:          _ipfsCID,
            issuer:           msg.sender,
            issuerPassDID:    "",
            candidate:        msg.sender,
            candidatePassDID: _candidatePassDID,
            tier:             Tier.SELF_ATTESTED,
            issuedAt:         block.timestamp,
            isRevoked:        false,
            revokeReason:     "",
            nftTokenId:       tokenId
        });

        candidateCredentials[msg.sender].push(credentialId);
        allCredentialIds.push(credentialId);

        emit CredentialIssued(
            credentialId, msg.sender, msg.sender,
            _credentialHash, Tier.SELF_ATTESTED, block.timestamp
        );
    }

    // Institution confirms a self-attested doc, upgrades it to Tier 1
    function upgradeToTier1(bytes32 _credentialId) external {
        require(institutionRegistry.isVerified(msg.sender), "Not a verified institution");

        Credential storage cred = credentials[_credentialId];
        require(cred.issuedAt > 0, "Credential not found");
        require(cred.tier == Tier.SELF_ATTESTED, "Already Tier 1");
        require(!cred.isRevoked, "Credential is revoked");

        string memory issuerDID = "";
        IQIEPass _qiePass2 = institutionRegistry.qiePass();
        if (address(_qiePass2) != address(0)) {
            try _qiePass2.getDID(msg.sender) returns (string memory did) {
                issuerDID = did;
            } catch {}
        }

        cred.tier         = Tier.INSTITUTION_VERIFIED;
        cred.issuer       = msg.sender;
        cred.issuerPassDID = issuerDID;

        credentialNFT.updateTier(_credentialId, uint8(Tier.INSTITUTION_VERIFIED));
        emit CredentialUpgraded(_credentialId, msg.sender, block.timestamp);
    }

    function revokeCredential(
        bytes32 _credentialId,
        string calldata _reason
    ) external {
        Credential storage cred = credentials[_credentialId];
        require(cred.issuedAt > 0, "Credential not found");
        require(!cred.isRevoked, "Already revoked");
        require(bytes(_reason).length > 0, "Revocation reason required");
        require(
            cred.issuer == msg.sender || owner() == msg.sender,
            "Only issuer or admin can revoke"
        );

        cred.isRevoked    = true;
        cred.revokeReason = _reason;

        emit CredentialRevoked(_credentialId, msg.sender, _reason, block.timestamp);
    }

    function reissueCredential(
        bytes32 _oldCredentialId,
        address _newWallet,
        string calldata _newIpfsCID
    ) external returns (bytes32 newCredentialId) {
        require(institutionRegistry.isVerified(msg.sender), "Not a verified institution");

        Credential storage old = credentials[_oldCredentialId];
        require(old.issuer == msg.sender, "Not the original issuer");
        require(!old.isRevoked, "Old credential already revoked");

        old.isRevoked    = true;
        old.revokeReason = "Reissued to new wallet";

        newCredentialId = _generateCredentialId(old.credentialHash, msg.sender, _newWallet);

        uint256 tokenId = credentialNFT.mintCredential(
            _newWallet,
            newCredentialId,
            _newIpfsCID,
            uint8(Tier.INSTITUTION_VERIFIED)
        );

        credentials[newCredentialId] = Credential({
            credentialHash:   old.credentialHash,
            ipfsCID:          _newIpfsCID,
            issuer:           msg.sender,
            issuerPassDID:    old.issuerPassDID,
            candidate:        _newWallet,
            candidatePassDID: "",
            tier:             Tier.INSTITUTION_VERIFIED,
            issuedAt:         block.timestamp,
            isRevoked:        false,
            revokeReason:     "",
            nftTokenId:       tokenId
        });

        candidateCredentials[_newWallet].push(newCredentialId);
        allCredentialIds.push(newCredentialId);

        emit CredentialReissued(_oldCredentialId, newCredentialId, _newWallet);
    }

    function verifyCredential(bytes32 _credentialId) external view returns (
        bool    isValid,
        address issuer,
        string  memory issuerPassDID,
        address candidate,
        Tier    tier,
        uint256 issuedAt,
        bool    isRevoked,
        string  memory revokeReason
    ) {
        Credential memory cred = credentials[_credentialId];
        return (
            cred.issuedAt > 0 && !cred.isRevoked,
            cred.issuer,
            cred.issuerPassDID,
            cred.candidate,
            cred.tier,
            cred.issuedAt,
            cred.isRevoked,
            cred.revokeReason
        );
    }

    function getCredentialsByCandidate(address _candidate) external view returns (bytes32[] memory) {
        return candidateCredentials[_candidate];
    }

    function getTotalCredentials() external view returns (uint256) {
        return allCredentialIds.length;
    }

    function _generateCredentialId(
        bytes32 _hash,
        address _issuer,
        address _candidate
    ) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(_hash, _issuer, _candidate, block.chainid));
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
