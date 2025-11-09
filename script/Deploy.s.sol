// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PostageYieldManager} from "../src/PostageYieldManager.sol";

/// @title DeployPostageYieldManager
/// @notice Deployment script for PostageYieldManager on Gnosis Chain
contract DeployPostageYieldManager is Script {
    // Gnosis Chain addresses
    address constant SDAI_GNOSIS = 0xaf204776c7245bF4147c2612BF6e5972Ee483701;
    address constant DAI_GNOSIS = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d; // WXDAI
    address constant BZZ_GNOSIS = address(0); // TODO: Add BZZ token address on Gnosis
    address constant POSTAGE_STAMP_GNOSIS = address(0); // TODO: Add Swarm Postage Stamp address
    address constant DEX_ROUTER_GNOSIS = address(0); // TODO: Add DEX router (Honeyswap, etc.)

    // Chiado testnet addresses
    address constant SDAI_CHIADO = address(0); // TODO: Add testnet addresses
    address constant DAI_CHIADO = address(0);
    address constant BZZ_CHIADO = address(0);
    address constant POSTAGE_STAMP_CHIADO = address(0);
    address constant DEX_ROUTER_CHIADO = address(0);

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("=================================");
        console.log("Deploying PostageYieldManager");
        console.log("=================================");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        // Select addresses based on chain
        address sdaiAddress;
        address daiAddress;
        address bzzAddress;
        address postageStampAddress;
        address dexRouterAddress;

        if (block.chainid == 100) {
            // Gnosis Chain
            sdaiAddress = SDAI_GNOSIS;
            daiAddress = DAI_GNOSIS;
            bzzAddress = BZZ_GNOSIS;
            postageStampAddress = POSTAGE_STAMP_GNOSIS;
            dexRouterAddress = DEX_ROUTER_GNOSIS;
            console.log("Network: Gnosis Chain");
        } else if (block.chainid == 10200) {
            // Chiado testnet
            sdaiAddress = SDAI_CHIADO;
            daiAddress = DAI_CHIADO;
            bzzAddress = BZZ_CHIADO;
            postageStampAddress = POSTAGE_STAMP_CHIADO;
            dexRouterAddress = DEX_ROUTER_CHIADO;
            console.log("Network: Chiado Testnet");
        } else {
            revert("Unsupported network - deploy on Gnosis Chain (100) or Chiado (10200)");
        }

        console.log("sDAI Address:", sdaiAddress);
        console.log("DAI Address:", daiAddress);
        console.log("BZZ Address:", bzzAddress);
        console.log("Postage Stamp:", postageStampAddress);
        console.log("DEX Router:", dexRouterAddress);
        console.log("=================================");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy PostageYieldManager
        PostageYieldManager manager = new PostageYieldManager(
            sdaiAddress,
            daiAddress,
            bzzAddress,
            postageStampAddress,
            dexRouterAddress
        );

        console.log("\n=== Deployment Complete ===");
        console.log("PostageYieldManager:", address(manager));

        // Post-deployment verification
        require(address(manager.SDAI()) == sdaiAddress, "sDAI address mismatch");
        require(address(manager.DAI()) == daiAddress, "DAI address mismatch");
        require(address(manager.BZZ()) == bzzAddress, "BZZ address mismatch");
        require(address(manager.POSTAGE_STAMP()) == postageStampAddress, "Postage stamp mismatch");
        require(address(manager.dexRouter()) == dexRouterAddress, "DEX router mismatch");
        require(manager.owner() == deployer, "Owner not set correctly");

        console.log("\n=== Verification Passed ===");
        console.log("Owner:", manager.owner());
        console.log("Min Yield Threshold:", manager.minYieldThreshold());
        console.log("Max Slippage BPS:", manager.maxSlippageBps());

        vm.stopBroadcast();

        console.log("\n=== Next Steps ===");
        console.log("1. Users can now deposit sDAI:");
        console.log("   manager.deposit(sDAIAmount, stampId)");
        console.log("2. Adjust parameters if needed:");
        console.log("   manager.setMinYieldThreshold(newThreshold)");
        console.log("   manager.setMaxSlippage(newSlippageBps)");
        console.log("3. Harvest yield monthly:");
        console.log("   manager.harvest()");
        console.log("4. Verify contract on GnosisScan");
        console.log("=================================\n");
    }
}

/// @title ConfigureManager
/// @notice Post-deployment configuration script
contract ConfigureManager is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address managerAddress = vm.envAddress("MANAGER_ADDRESS");

        // Configuration parameters
        uint256 minYieldThreshold = vm.envOr("MIN_YIELD_THRESHOLD", uint256(10e18)); // 10 DAI
        uint256 maxSlippageBps = vm.envOr("MAX_SLIPPAGE_BPS", uint256(200)); // 2%

        console.log("=================================");
        console.log("Configuring PostageYieldManager");
        console.log("=================================");
        console.log("Manager Address:", managerAddress);
        console.log("Min Yield Threshold:", minYieldThreshold);
        console.log("Max Slippage BPS:", maxSlippageBps);
        console.log("=================================");

        vm.startBroadcast(deployerPrivateKey);

        PostageYieldManager manager = PostageYieldManager(managerAddress);

        // Set parameters
        manager.setMinYieldThreshold(minYieldThreshold);
        console.log("Min yield threshold set");

        manager.setMaxSlippage(maxSlippageBps);
        console.log("Max slippage set");

        vm.stopBroadcast();

        // Verify configuration
        require(manager.minYieldThreshold() == minYieldThreshold, "Threshold not set");
        require(manager.maxSlippageBps() == maxSlippageBps, "Slippage not set");

        console.log("\n=== Configuration Complete ===");
        console.log("Manager is ready for use");
        console.log("=================================\n");
    }
}
