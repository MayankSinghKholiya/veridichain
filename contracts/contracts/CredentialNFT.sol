// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title CredentialNFT
/// @notice Soulbound ERC-721 — one NFT per credential, non-transferable
contract CredentialNFT is ERC721, Ownable {

    address public credentialRegistry;

    uint256 private _tokenIdCounter;

    struct NFTMetadata {
        bytes32 credentialId;
        string  ipfsCID;
        uint8   tier;           // 1 = institution verified, 2 = self attested
        uint256 issuedAt;
    }

    mapping(uint256 => NFTMetadata) public tokenMetadata;
    mapping(bytes32 => uint256)     public credentialToToken;

    event CredentialNFTMinted(address indexed to, uint256 tokenId, bytes32 credentialId);
    event CredentialNFTTierUpdated(uint256 tokenId, uint8 newTier);

    modifier onlyRegistry() {
        require(msg.sender == credentialRegistry || msg.sender == owner(), "Not registry");
        _;
    }

    constructor() ERC721("VeridiChain Credential", "VCRED") {}

    function setRegistry(address _registry) external onlyOwner {
        credentialRegistry = _registry;
    }

    /// @notice Mint soulbound credential NFT — called by CredentialRegistry
    function mintCredential(
        address _to,
        bytes32 _credentialId,
        string calldata _ipfsCID,
        uint8 _tier
    ) external onlyRegistry returns (uint256 tokenId) {
        tokenId = ++_tokenIdCounter;

        _mint(_to, tokenId);

        tokenMetadata[tokenId] = NFTMetadata({
            credentialId: _credentialId,
            ipfsCID:      _ipfsCID,
            tier:         _tier,
            issuedAt:     block.timestamp
        });

        credentialToToken[_credentialId] = tokenId;

        emit CredentialNFTMinted(_to, tokenId, _credentialId);
    }

    /// @notice Update tier when Tier 2 is upgraded to Tier 1
    function updateTier(bytes32 _credentialId, uint8 _newTier) external onlyRegistry {
        uint256 tokenId = credentialToToken[_credentialId];
        require(tokenId != 0, "Token not found");
        tokenMetadata[tokenId].tier = _newTier;
        emit CredentialNFTTierUpdated(tokenId, _newTier);
    }

    // ─── Soulbound: block all transfers except minting (OZ v4 hook) ──────────
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {
        // Allow minting (from == address(0)) but block all transfers
        require(from == address(0), "VeridiChain: credential NFT is soulbound");
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "ERC721: invalid token ID");
        NFTMetadata memory meta = tokenMetadata[tokenId];
        // Return IPFS CID — frontend renders metadata from there
        return string(abi.encodePacked("ipfs://", meta.ipfsCID));
    }

    function totalSupply() external view returns (uint256) {
        return _tokenIdCounter;
    }
}
