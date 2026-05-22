// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EtherPoolFactory} from "../src/EtherPoolFactory.sol";

contract DeployEtherPoolFactory is Script {
    function run() external returns (EtherPoolFactory factory) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(privateKey);
        factory = new EtherPoolFactory();
        vm.stopBroadcast();

        console2.log("EtherPoolFactory deployed at:", address(factory));
    }
}
