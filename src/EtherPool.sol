// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One immutable ETH payment pool for a single payment tab.
/// @dev V1 intentionally supports only EOA recipients. Contract wallets,
/// multisigs, and Safes are unsupported to reduce payout failure risk when
/// complete() sends ETH to the immutable recipient.
contract EtherPool is ReentrancyGuard {
    uint256 public immutable totalDue;
    uint256 public immutable dueDate;
    address payable public immutable recipient;
    address public immutable factory;
    address public immutable creator;

    uint256 public totalContributed;
    uint256 public completedAt;
    bool public completed;

    // Claims are keyed to the direct sending address. Users should not pay from
    // exchanges or custodial wallets unless that address can later claim funds.
    mapping(address contributor => uint256 amount) public contributions;
    mapping(address contributor => uint256 amount) public excessBalances;

    error InvalidTotalDue();
    error InvalidDueDate();
    error InvalidRecipient();
    error RecipientCannotBeContract();
    error ZeroContribution();
    error PoolAlreadyCompleted();
    error PoolNotFunded();
    error PoolStillActive();
    error PoolFunded();
    error NothingToClaim();
    error TransferFailed();

    event Contribution(address indexed contributor, uint256 acceptedAmount, uint256 excessAmount);
    event Completed(address indexed recipient, uint256 amount, uint256 completedAt);
    event ContributionClaimed(address indexed contributor, uint256 amount);
    event ExcessClaimed(address indexed contributor, uint256 amount);

    constructor(uint256 totalDue_, uint256 dueDate_, address payable recipient_, address creator_) {
        if (totalDue_ == 0) revert InvalidTotalDue();
        if (dueDate_ <= block.timestamp) revert InvalidDueDate();
        if (recipient_ == address(0)) revert InvalidRecipient();
        if (recipient_.code.length != 0) revert RecipientCannotBeContract();

        totalDue = totalDue_;
        dueDate = dueDate_;
        recipient = recipient_;
        factory = msg.sender;
        creator = creator_;
    }

    receive() external payable {
        contribute();
    }

    function contribute() public payable nonReentrant {
        if (msg.value == 0) revert ZeroContribution();

        if (completed || block.timestamp > dueDate || totalContributed >= totalDue) {
            excessBalances[msg.sender] += msg.value;
            emit Contribution(msg.sender, 0, msg.value);
            return;
        }

        uint256 remaining = totalDue - totalContributed;
        uint256 acceptedAmount = msg.value > remaining ? remaining : msg.value;
        uint256 excessAmount = msg.value - acceptedAmount;

        totalContributed += acceptedAmount;
        contributions[msg.sender] += acceptedAmount;

        if (excessAmount > 0) {
            excessBalances[msg.sender] += excessAmount;
        }

        emit Contribution(msg.sender, acceptedAmount, excessAmount);
    }

    // Completion is intentionally manual instead of automatic in receive().
    // Direct ETH sends should not unexpectedly revert because the recipient
    // cannot accept ETH at that moment; anyone can call complete() once funded.
    function complete() external nonReentrant {
        if (completed) revert PoolAlreadyCompleted();
        if (totalContributed < totalDue) revert PoolNotFunded();

        completed = true;
        completedAt = block.timestamp;

        (bool success,) = recipient.call{value: totalDue}("");
        if (!success) revert TransferFailed();

        emit Completed(recipient, totalDue, completedAt);
    }

    function claimContribution() external nonReentrant {
        if (block.timestamp <= dueDate) revert PoolStillActive();
        if (totalContributed >= totalDue) revert PoolFunded();

        uint256 amount = contributions[msg.sender];
        if (amount == 0) revert NothingToClaim();

        contributions[msg.sender] = 0;

        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ContributionClaimed(msg.sender, amount);
    }

    function claimExcess() external nonReentrant {
        uint256 amount = excessBalances[msg.sender];
        if (amount == 0) revert NothingToClaim();

        excessBalances[msg.sender] = 0;

        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ExcessClaimed(msg.sender, amount);
    }

    function amountRemaining() external view returns (uint256) {
        if (totalContributed >= totalDue) return 0;
        return totalDue - totalContributed;
    }

    function isExpired() public view returns (bool) {
        return block.timestamp > dueDate;
    }

    function isComplete() external view returns (bool) {
        return completed;
    }

    function claimableContribution(address contributor) external view returns (uint256) {
        if (block.timestamp <= dueDate || totalContributed >= totalDue) return 0;
        return contributions[contributor];
    }

    function claimableExcess(address contributor) external view returns (uint256) {
        return excessBalances[contributor];
    }
}
