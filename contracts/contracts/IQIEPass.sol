// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IQIEPass
/// @notice Interface for QIE Pass identity contract
/// @dev Replace function signatures once QIE Pass ABI is available from docs.qie.digital
interface IQIEPass {
    /// @notice Check if an address holds a valid QIE Pass
    function hasValidPass(address account) external view returns (bool);

    /// @notice Get the DID associated with an address
    function getDID(address account) external view returns (string memory);

    /// @notice Get pass expiry timestamp
    function getPassExpiry(address account) external view returns (uint256);

    /// @notice Check if pass is revoked
    function isRevoked(address account) external view returns (bool);
}
