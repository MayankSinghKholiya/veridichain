// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IQIEDex
/// @notice Interface for QIEDEX — Uniswap V2-compatible DEX on QIE blockchain
/// @dev Router address (mainnet): 0x08cd2e72e156D8563B4351eb4065C262A9f553Ef
interface IQIEDex {
    /// @notice Add liquidity to a token pair pool (Uniswap V2 Router signature)
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    /// @notice Add liquidity with native QIE (ETH-equivalent)
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    /// @notice Get amounts out for a swap path
    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);
}
