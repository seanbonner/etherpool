// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface Vm {
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

library console2 {
    address constant CONSOLE2_ADDRESS = 0x000000000000000000636F6e736F6c652e6c6f67;

    function log(string memory message, address value) internal view {
        (bool success,) = CONSOLE2_ADDRESS.staticcall(abi.encodeWithSignature("log(string,address)", message, value));
        success;
    }
}

abstract contract Script {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
