// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {PostageYieldManagerUpgradeable} from "../src/PostageYieldManagerUpgradeable.sol";

/// @title DeployUpgradeable
/// @notice Deployment script for upgradeable PostageYieldManager using Transparent Proxy
contract DeployUpgradeable is Script {
    // Gnosis Chain addresses (Verified for Gnosis Mainnet)
    address constant SDAI = address(0xaf204776c7245bF4147c2612BF6e5972Ee483701); // Savings xDAI (sDAI)
    address constant DAI = address(0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d); // wxDAI (Wrapped xDAI - ERC-20)
    address constant BZZ = address(0xdBF3Ea6F5beE45c02255B2c26a16F300502F68da); // BZZ token (16 decimals)
    address constant POSTAGE_STAMP = address(0x45a1502382541Cd610CC9068e88727426b696293); // Swarm PostageStamp contract
    address constant DEX_ROUTER = address(0xE43e60736b1cb4a75ad25240E2f9a62Bff65c0C0); // Swapr (DXswap) Router

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Deployer balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy the Transparent Proxy with the implementation
        // The proxy will be owned by the deployer (ProxyAdmin will be created automatically)
        address proxy = Upgrades.deployTransparentProxy(
            "PostageYieldManagerUpgradeable.sol:PostageYieldManagerUpgradeable",
            deployer, // Initial owner and proxy admin owner
            abi.encodeCall(PostageYieldManagerUpgradeable.initialize, (SDAI, DAI, BZZ, POSTAGE_STAMP, DEX_ROUTER))
        );

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("PostageYieldManager Proxy deployed at:", proxy);
        console.log("===========================================");
        console.log("");
        console.log("IMPORTANT: Save these addresses!");
        console.log("Proxy Address:", proxy);
        console.log("");
        console.log("To interact with the contract, use the Proxy address");
        console.log("To upgrade later, use: forge script script/UpgradeContract.s.sol");
    }
}
