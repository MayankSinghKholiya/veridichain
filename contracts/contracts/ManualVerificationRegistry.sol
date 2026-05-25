// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ManualVerificationRegistry
/// @notice Candidates submit documents for manual review by the VeridiChain team.
///         Owner (main admin) manages verifiers. Verifiers approve/reject requests.
///         On approval the credential gets an immutable TeamVerification record on-chain.
contract ManualVerificationRegistry {

    // ── Roles ──────────────────────────────────────────────────────────────
    address public owner;
    mapping(address => bool) public isVerifier;
    address[] private _verifierList;

    // ── Fee ────────────────────────────────────────────────────────────────
    uint256 public verificationFee; // wei — default 0 (free on testnet)

    // ── Enums + Structs ────────────────────────────────────────────────────
    enum Status { Pending, Approved, Rejected }

    struct VerificationRequest {
        uint256 id;
        bytes32 credentialId;
        address candidate;
        string  documentIpfsCID;   // IPFS CID of uploaded document
        string  candidateNote;     // candidate's message to the team
        Status  status;
        address reviewedBy;
        string  reviewNote;        // team's approval note / rejection reason
        uint256 submittedAt;
        uint256 reviewedAt;
    }

    struct TeamVerification {
        bool    verified;
        string  note;
        address verifiedBy;
        uint256 verifiedAt;
    }

    uint256 public requestCount;
    mapping(uint256 => VerificationRequest) public requests;
    uint256[] private _allRequestIds;

    // credentialId → latest requestId (used to prevent double-pending)
    mapping(bytes32 => uint256) public credentialToRequest;
    // credentialId → team verification result (only set on approval)
    mapping(bytes32 => TeamVerification) public teamVerifications;

    // ── Events ─────────────────────────────────────────────────────────────
    event VerificationRequested(
        uint256 indexed requestId,
        bytes32 indexed credentialId,
        address indexed candidate,
        uint256 timestamp
    );
    event VerificationApproved(
        uint256 indexed requestId,
        bytes32 indexed credentialId,
        address indexed verifier,
        string  note,
        uint256 timestamp
    );
    event VerificationRejected(
        uint256 indexed requestId,
        bytes32 indexed credentialId,
        address indexed verifier,
        string  reason,
        uint256 timestamp
    );
    event VerifierAdded(address indexed verifier, address indexed addedBy);
    event VerifierRemoved(address indexed verifier, address indexed removedBy);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeesWithdrawn(address indexed to, uint256 amount);

    // ── Modifiers ──────────────────────────────────────────────────────────
    modifier onlyOwner()  { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyTeam()   {
        require(msg.sender == owner || isVerifier[msg.sender], "Not a team member");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        verificationFee = 0;
    }

    // ── Owner: verifier management ─────────────────────────────────────────
    function addVerifier(address _v) external onlyOwner {
        require(_v != address(0),  "Zero address");
        require(_v != owner,       "Owner is already team");
        require(!isVerifier[_v],   "Already a verifier");
        isVerifier[_v] = true;
        _verifierList.push(_v);
        emit VerifierAdded(_v, msg.sender);
    }

    function removeVerifier(address _v) external onlyOwner {
        require(isVerifier[_v], "Not a verifier");
        isVerifier[_v] = false;
        for (uint256 i = 0; i < _verifierList.length; i++) {
            if (_verifierList[i] == _v) {
                _verifierList[i] = _verifierList[_verifierList.length - 1];
                _verifierList.pop();
                break;
            }
        }
        emit VerifierRemoved(_v, msg.sender);
    }

    function setFee(uint256 _fee) external onlyOwner {
        emit FeeUpdated(verificationFee, _fee);
        verificationFee = _fee;
    }

    function withdrawFees() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to withdraw");
        (bool ok,) = owner.call{value: bal}("");
        require(ok, "Transfer failed");
        emit FeesWithdrawn(owner, bal);
    }

    // ── Candidate: submit request ──────────────────────────────────────────
    function submitVerificationRequest(
        bytes32 _credentialId,
        string calldata _documentIpfsCID,
        string calldata _candidateNote
    ) external payable returns (uint256 requestId) {
        require(msg.value >= verificationFee,            "Insufficient fee");
        require(_credentialId != bytes32(0),             "Invalid credential ID");
        require(bytes(_documentIpfsCID).length > 0,     "Document CID required");

        uint256 existing = credentialToRequest[_credentialId];
        if (existing > 0) {
            require(
                requests[existing].status != Status.Pending,
                "Active pending request exists"
            );
        }

        requestCount++;
        requestId = requestCount;

        requests[requestId] = VerificationRequest({
            id:              requestId,
            credentialId:    _credentialId,
            candidate:       msg.sender,
            documentIpfsCID: _documentIpfsCID,
            candidateNote:   _candidateNote,
            status:          Status.Pending,
            reviewedBy:      address(0),
            reviewNote:      "",
            submittedAt:     block.timestamp,
            reviewedAt:      0
        });

        _allRequestIds.push(requestId);
        credentialToRequest[_credentialId] = requestId;

        emit VerificationRequested(requestId, _credentialId, msg.sender, block.timestamp);
    }

    // ── Team: approve ──────────────────────────────────────────────────────
    function approveRequest(uint256 _requestId, string calldata _note) external onlyTeam {
        VerificationRequest storage req = requests[_requestId];
        require(req.id > 0,                   "Request not found");
        require(req.status == Status.Pending, "Not pending");

        req.status     = Status.Approved;
        req.reviewedBy = msg.sender;
        req.reviewNote = _note;
        req.reviewedAt = block.timestamp;

        teamVerifications[req.credentialId] = TeamVerification({
            verified:   true,
            note:       _note,
            verifiedBy: msg.sender,
            verifiedAt: block.timestamp
        });

        emit VerificationApproved(_requestId, req.credentialId, msg.sender, _note, block.timestamp);
    }

    // ── Team: reject ───────────────────────────────────────────────────────
    function rejectRequest(uint256 _requestId, string calldata _reason) external onlyTeam {
        VerificationRequest storage req = requests[_requestId];
        require(req.id > 0,                   "Request not found");
        require(req.status == Status.Pending, "Not pending");
        require(bytes(_reason).length > 0,    "Reason required");

        req.status     = Status.Rejected;
        req.reviewedBy = msg.sender;
        req.reviewNote = _reason;
        req.reviewedAt = block.timestamp;

        emit VerificationRejected(_requestId, req.credentialId, msg.sender, _reason, block.timestamp);
    }

    // ── Views ──────────────────────────────────────────────────────────────
    function getRequest(uint256 _requestId)
        external view returns (VerificationRequest memory)
    {
        return requests[_requestId];
    }

    function getAllRequestIds() external view returns (uint256[] memory) {
        return _allRequestIds;
    }

    function getTeamVerification(bytes32 _credentialId)
        external view returns (TeamVerification memory)
    {
        return teamVerifications[_credentialId];
    }

    function getVerifierList() external view returns (address[] memory) {
        return _verifierList;
    }

    function isTeamMember(address _addr) external view returns (bool) {
        return _addr == owner || isVerifier[_addr];
    }
}
