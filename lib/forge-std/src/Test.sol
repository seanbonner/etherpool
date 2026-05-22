// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface Vm {
    function deal(address who, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert(bytes4 revertData) external;
    function prank(address msgSender) external;
    function warp(uint256 newTimestamp) external;
}

abstract contract Test {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint256 values are not equal");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address values are not equal");
    }

    function assertTrue(bool value) internal pure {
        require(value, "value is not true");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "value is not false");
    }
}
