// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EtherPool} from "./EtherPool.sol";

contract EtherPoolFactory {
    // Normal deployment keeps v1 easy to inspect. Minimal proxy clones can be
    // added later if deployment cost becomes more important than simplicity.
    address[] private pools;

    event PoolCreated(
        address indexed pool, address indexed creator, uint256 totalDue, uint256 dueDate, address indexed recipient
    );

    function createPool(uint256 totalDue, uint256 dueDate, address payable recipient) external returns (address pool) {
        pool = address(new EtherPool(totalDue, dueDate, recipient, msg.sender));
        pools.push(pool);

        emit PoolCreated(pool, msg.sender, totalDue, dueDate, recipient);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function poolAt(uint256 index) external view returns (address) {
        return pools[index];
    }

    function allPools() external view returns (address[] memory) {
        return pools;
    }
}
