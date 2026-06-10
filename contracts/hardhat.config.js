require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "shanghai",   // QIE testnet does not support Cancun (no MCOPY opcode 0x5e)
        },
      },
    ],
  },
  networks: {
    qie_testnet: {
      url: process.env.QIE_RPC_URL || "https://rpc1testnet.qie.digital/",
      chainId: 1983,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
    qie_mainnet: {
      url: process.env.QIE_MAINNET_RPC_URL || "https://rpc1mainnet.qie.digital/",
      chainId: 1990,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      qie_testnet:  process.env.QIE_EXPLORER_API_KEY || "placeholder",
      qie_mainnet:  process.env.QIE_MAINNET_EXPLORER_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "qie_testnet",
        chainId: 1983,
        urls: {
          apiURL:     "https://testnet.qie.digital/api",
          browserURL: "https://testnet.qie.digital",
        },
      },
      {
        network: "qie_mainnet",
        chainId: 1990,
        urls: {
          apiURL:     "https://mainnet.qie.digital/api",
          browserURL: "https://mainnet.qie.digital",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
