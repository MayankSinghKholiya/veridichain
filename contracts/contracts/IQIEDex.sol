// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IQIEDex
/// @notice Interface for QIE DEX liquidity functions
/// @dev Replace with actual ABI from dex.qie.digital
interface IQIEDex {
    /// @notice Add liquidity to a token pair pool
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBMin,
        address to
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    /// @notice Get pool reserves
    function getReserves(
        address tokenA,
        address tokenB
    ) external view returns (uint256 reserveA, uint256 reserveB);
}
