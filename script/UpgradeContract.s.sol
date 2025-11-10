// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Upgrades, Options} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {PostageYieldManagerUpgradeable} from "../src/PostageYieldManagerUpgradeable.sol";

/// @title UpgradeContract
/// @notice Script to upgrade the PostageYieldManager implementation
/// @dev This will deploy a new implementation and update the proxy to point to it
contract UpgradeContract is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Address of the existing proxy
        address proxy = vm.envAddress("PROXY_ADDRESS");

        console.log("Upgrader:", deployer);
        console.log("Current Proxy:", proxy);

        vm.startBroadcast(deployerPrivateKey);

        // Configure upgrade options
        // Skip storage layout check because we don't have the original build artifacts
        // This is safe because we manually verified we only added a new function
        Options memory opts;
        opts.unsafeSkipStorageCheck = true;

        // Perform the upgrade
        Upgrades.upgradeProxy(proxy, "PostageYieldManagerUpgradeable.sol:PostageYieldManagerUpgradeable", "", opts);

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("Contract upgraded successfully!");
        console.log("Proxy Address (unchanged):", proxy);
        console.log("===========================================");
        console.log("");
        console.log("WARNING: Storage layout check was skipped.");
        console.log("This upgrade added the depositWithPermit() function.");
        console.log("No storage variables were modified.");
    }
}
