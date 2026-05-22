// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {EtherPool} from "../src/EtherPool.sol";
import {EtherPoolFactory} from "../src/EtherPoolFactory.sol";

contract PlainContractRecipient {
    receive() external payable {}
}

contract RejectingRecipient {
    receive() external payable {
        revert("reject ETH");
    }
}

contract ExchangeLikeSender {
    function pay(address payable pool) external payable {
        (bool success,) = pool.call{value: msg.value}("");
        require(success, "payment failed");
    }

    receive() external payable {}
}

contract ForceSender {
    constructor() payable {}

    function forceSend(address payable target) external {
        selfdestruct(target);
    }
}

contract EtherPoolTest is Test {
    EtherPoolFactory internal factory;
    EtherPool internal pool;

    address payable internal recipient = payable(address(0xCAFE));
    address internal creator = address(0xC0DE);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA401);

    uint256 internal dueDate;

    event PoolCreated(
        address indexed pool, address indexed creator, uint256 totalDue, uint256 dueDate, address indexed recipient
    );

    function setUp() public {
        factory = new EtherPoolFactory();
        dueDate = block.timestamp + 7 days;

        vm.deal(creator, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);

        vm.prank(creator);
        address poolAddress = factory.createPool(3 ether, dueDate, recipient);
        pool = EtherPool(payable(poolAddress));
    }

    function testFactoryCreatesPoolWithCorrectImmutableTerms() public view {
        assertEq(pool.totalDue(), 3 ether);
        assertEq(pool.dueDate(), dueDate);
        assertEq(pool.recipient(), recipient);
        assertEq(pool.factory(), address(factory));
        assertEq(pool.creator(), creator);
    }

    function testFactoryRejectsZeroAddressRecipient() public {
        vm.expectRevert(EtherPool.InvalidRecipient.selector);
        factory.createPool(1 ether, dueDate, payable(address(0)));
    }

    function testFactoryRejectsPlainContractRecipient() public {
        PlainContractRecipient contractRecipient = new PlainContractRecipient();

        vm.expectRevert(EtherPool.RecipientCannotBeContract.selector);
        factory.createPool(1 ether, dueDate, payable(address(contractRecipient)));
    }

    function testFactoryRejectsRejectingContractRecipient() public {
        RejectingRecipient rejectingRecipient = new RejectingRecipient();

        vm.expectRevert(EtherPool.RecipientCannotBeContract.selector);
        factory.createPool(1 ether, dueDate, payable(address(rejectingRecipient)));
    }

    function testFactoryAcceptsNormalEoaRecipient() public {
        address payable eoaRecipient = payable(address(0xE0A));

        address poolAddress = factory.createPool(1 ether, dueDate, eoaRecipient);
        EtherPool eoaPool = EtherPool(payable(poolAddress));

        assertEq(eoaPool.recipient(), eoaRecipient);
    }

    function testDirectDeploymentRejectsZeroAddressRecipient() public {
        vm.expectRevert(EtherPool.InvalidRecipient.selector);
        new EtherPool(1 ether, dueDate, payable(address(0)), creator);
    }

    function testDirectDeploymentRejectsPlainContractRecipient() public {
        PlainContractRecipient contractRecipient = new PlainContractRecipient();

        vm.expectRevert(EtherPool.RecipientCannotBeContract.selector);
        new EtherPool(1 ether, dueDate, payable(address(contractRecipient)), creator);
    }

    function testDirectDeploymentRejectsRejectingContractRecipient() public {
        RejectingRecipient rejectingRecipient = new RejectingRecipient();

        vm.expectRevert(EtherPool.RecipientCannotBeContract.selector);
        new EtherPool(1 ether, dueDate, payable(address(rejectingRecipient)), creator);
    }

    function testFactoryEmitsPoolCreated() public {
        EtherPoolFactory freshFactory = new EtherPoolFactory();

        vm.expectEmit(false, true, true, true, address(freshFactory));
        emit PoolCreated(address(0), creator, 1 ether, dueDate, recipient);

        vm.prank(creator);
        freshFactory.createPool(1 ether, dueDate, recipient);
    }

    function testFactoryStoresAndReturnsCreatedPools() public view {
        assertEq(factory.poolCount(), 1);
        assertEq(factory.poolAt(0), address(pool));

        address[] memory pools = factory.allPools();
        assertEq(pools.length, 1);
        assertEq(pools[0], address(pool));
    }

    function testCreatePoolChargesNoDevFee() public {
        uint256 creatorBalanceBefore = creator.balance;

        vm.prank(creator);
        factory.createPool(1 ether, dueDate, payable(address(0xE0A)));

        assertEq(creator.balance, creatorBalanceBefore);
        assertEq(address(factory).balance, 0);
    }

    function testCreatePoolDoesNotAcceptEth() public {
        vm.prank(creator);
        (bool success,) = address(factory).call{value: 1 wei}(
            abi.encodeCall(EtherPoolFactory.createPool, (1 ether, dueDate, recipient))
        );

        assertFalse(success);
        assertEq(address(factory).balance, 0);
    }

    function testAcceptsDirectEthViaReceive() public {
        vm.prank(alice);
        (bool success,) = payable(address(pool)).call{value: 1 ether}("");

        assertTrue(success);
        assertEq(pool.contributions(alice), 1 ether);
        assertEq(pool.totalContributed(), 1 ether);
    }

    function testAcceptsEthViaContribute() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        assertEq(pool.contributions(alice), 1 ether);
        assertEq(address(pool).balance, 1 ether);
    }

    function testTracksContributionsBySender() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.prank(bob);
        pool.contribute{value: 2 ether}();

        assertEq(pool.contributions(alice), 1 ether);
        assertEq(pool.contributions(bob), 2 ether);
        assertEq(pool.totalContributed(), 3 ether);
    }

    function testCompletesWhenTotalDueIsReached() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        pool.complete();

        assertTrue(pool.isComplete());
        assertEq(pool.completedAt(), block.timestamp);
    }

    function testSendsExactlyTotalDueToRecipient() public {
        vm.prank(alice);
        pool.contribute{value: 4 ether}();

        uint256 startingRecipientBalance = recipient.balance;

        pool.complete();

        assertEq(recipient.balance, startingRecipientBalance + 3 ether);
        assertEq(address(pool).balance, 1 ether);
    }

    function testExcessNeverGoesToRecipient() public {
        vm.prank(alice);
        pool.contribute{value: 4 ether}();

        uint256 startingRecipientBalance = recipient.balance;

        pool.complete();

        vm.prank(alice);
        pool.claimExcess();

        assertEq(recipient.balance, startingRecipientBalance + 3 ether);
        assertEq(alice.balance, 7 ether);
    }

    function testCreditsOverpaymentAsExcess() public {
        vm.prank(alice);
        pool.contribute{value: 4 ether}();

        assertEq(pool.contributions(alice), 3 ether);
        assertEq(pool.excessBalances(alice), 1 ether);
        assertEq(pool.claimableExcess(alice), 1 ether);
        assertEq(pool.totalContributed(), 3 ether);
    }

    function testLetsSenderClaimExcess() public {
        vm.prank(alice);
        pool.contribute{value: 4 ether}();

        vm.prank(alice);
        pool.claimExcess();

        assertEq(pool.excessBalances(alice), 0);
        assertEq(alice.balance, 7 ether);
    }

    function testIsFailedAfterDueDateIfUnderfunded() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.warp(dueDate + 1);

        assertTrue(pool.isExpired());
        assertEq(pool.claimableContribution(alice), 1 ether);
    }

    function testLetsContributorsClaimContributionsAfterFailure() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.prank(bob);
        pool.contribute{value: 1 ether}();

        vm.warp(dueDate + 1);

        vm.prank(alice);
        pool.claimContribution();

        vm.prank(bob);
        pool.claimContribution();

        assertEq(pool.contributions(alice), 0);
        assertEq(pool.contributions(bob), 0);
        assertEq(alice.balance, 10 ether);
        assertEq(bob.balance, 10 ether);
    }

    function testDoesNotAllowContributionClaimAfterSuccess() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        vm.warp(dueDate + 1);

        vm.prank(alice);
        vm.expectRevert(EtherPool.PoolFunded.selector);
        pool.claimContribution();
    }

    function testDoesNotAllowExcessClaimByAnyoneExceptOriginalSender() public {
        vm.prank(alice);
        pool.contribute{value: 4 ether}();

        vm.prank(bob);
        vm.expectRevert(EtherPool.NothingToClaim.selector);
        pool.claimExcess();

        assertEq(pool.excessBalances(alice), 1 ether);
    }

    function testCannotCompleteBeforeTotalDueIsReached() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.expectRevert(EtherPool.PoolNotFunded.selector);
        pool.complete();
    }

    function testCannotCompleteTwice() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        pool.complete();

        vm.expectRevert(EtherPool.PoolAlreadyCompleted.selector);
        pool.complete();
    }

    function testCannotClaimContributionBeforeDueDateFailure() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(EtherPool.PoolStillActive.selector);
        pool.claimContribution();
    }

    function testHandlesMultipleContributorsCorrectly() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.prank(bob);
        pool.contribute{value: 15 ether / 10}();

        vm.prank(carol);
        pool.contribute{value: 1 ether}();

        assertEq(pool.contributions(alice), 1 ether);
        assertEq(pool.contributions(bob), 15 ether / 10);
        assertEq(pool.contributions(carol), 5 ether / 10);
        assertEq(pool.excessBalances(carol), 5 ether / 10);
        assertEq(pool.totalContributed(), 3 ether);
    }

    function testDirectSendFromContractMakesThatContractTheClaimant() public {
        ExchangeLikeSender exchange = new ExchangeLikeSender();
        vm.deal(address(exchange), 5 ether);

        // Exchange/custodial-style sends make that sending contract the claimant,
        // not the human or account that funded the contract behind the scenes.
        vm.prank(address(exchange));
        exchange.pay{value: 4 ether}(payable(address(pool)));

        assertEq(pool.contributions(address(exchange)), 3 ether);
        assertEq(pool.excessBalances(address(exchange)), 1 ether);
        assertEq(pool.excessBalances(alice), 0);

        vm.expectRevert(EtherPool.NothingToClaim.selector);
        pool.claimExcess();

        vm.prank(address(exchange));
        pool.claimExcess();

        assertEq(address(exchange).balance, 2 ether);
    }

    function testForcedEthDoesNotIncreaseRecipientPayoutBeyondTotalDue() public {
        ForceSender forceSender = new ForceSender{value: 5 ether}();
        forceSender.forceSend(payable(address(pool)));

        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        uint256 startingRecipientBalance = recipient.balance;

        pool.complete();

        assertEq(recipient.balance, startingRecipientBalance + 3 ether);
        assertEq(address(pool).balance, 5 ether);
        assertEq(address(factory).balance, 0);
    }

    function testNoOwnerOrAdminWithdrawalFunctions() public {
        (bool ownerSuccess,) = address(pool).call(abi.encodeWithSignature("owner()"));
        (bool withdrawSuccess,) = address(pool).call(abi.encodeWithSignature("withdraw()"));
        (bool sweepSuccess,) = address(pool).call(abi.encodeWithSignature("sweep()"));
        (bool rescueSuccess,) = address(pool).call(abi.encodeWithSignature("rescue(address)"));

        assertFalse(ownerSuccess);
        assertFalse(withdrawSuccess);
        assertFalse(sweepSuccess);
        assertFalse(rescueSuccess);
    }

    function testContributionsAfterCompletionAreFullExcess() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        pool.complete();

        vm.prank(bob);
        pool.contribute{value: 1 ether}();

        assertEq(pool.contributions(bob), 0);
        assertEq(pool.excessBalances(bob), 1 ether);
    }

    function testContributionsAfterDueDateAreFullExcess() public {
        vm.warp(dueDate + 1);

        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        assertEq(pool.contributions(alice), 0);
        assertEq(pool.excessBalances(alice), 1 ether);
        assertEq(pool.totalContributed(), 0);
    }

    function testNewPoolStatusIsActive() public view {
        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Active));
        assertFalse(pool.isFunded());
        assertFalse(pool.isFailed());
        assertFalse(pool.canComplete());
    }

    function testUnderfundedBeforeDueDateIsActive() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Active));
        assertFalse(pool.isFunded());
        assertFalse(pool.isFailed());
        assertFalse(pool.canComplete());
    }

    function testFundedButNotCompletedStatusIsFunded() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Funded));
        assertTrue(pool.isFunded());
        assertFalse(pool.isFailed());
        assertTrue(pool.canComplete());
    }

    function testFundedStatusHoldsAfterDueDateUntilCompleted() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        vm.warp(dueDate + 1);

        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Funded));
        assertTrue(pool.isFunded());
        assertFalse(pool.isFailed());
        assertTrue(pool.canComplete());
    }

    function testCompletedStatusIsCompleted() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        pool.complete();

        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Completed));
        assertFalse(pool.isFunded());
        assertFalse(pool.isFailed());
        assertFalse(pool.canComplete());
    }

    function testUnderfundedAfterDueDateStatusIsFailed() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        vm.warp(dueDate + 1);

        assertEq(uint256(pool.status()), uint256(EtherPool.PoolStatus.Failed));
        assertFalse(pool.isFunded());
        assertTrue(pool.isFailed());
        assertFalse(pool.canComplete());
    }

    function testIsFundedTrueOnlyWhenFundedAndNotCompleted() public {
        assertFalse(pool.isFunded());

        vm.prank(alice);
        pool.contribute{value: 2 ether}();
        assertFalse(pool.isFunded());

        vm.prank(bob);
        pool.contribute{value: 1 ether}();
        assertTrue(pool.isFunded());

        pool.complete();
        assertFalse(pool.isFunded());
    }

    function testIsFailedTrueOnlyAfterDueDateWhenUnderfunded() public {
        vm.prank(alice);
        pool.contribute{value: 1 ether}();

        assertFalse(pool.isFailed());

        vm.warp(dueDate);
        assertFalse(pool.isFailed());

        vm.warp(dueDate + 1);
        assertTrue(pool.isFailed());
    }

    function testCanCompleteTrueOnlyWhenFundedAndNotCompleted() public {
        assertFalse(pool.canComplete());

        vm.prank(alice);
        pool.contribute{value: 1 ether}();
        assertFalse(pool.canComplete());

        vm.prank(bob);
        pool.contribute{value: 2 ether}();
        assertTrue(pool.canComplete());
    }

    function testCanCompleteFalseAfterCompleted() public {
        vm.prank(alice);
        pool.contribute{value: 3 ether}();

        assertTrue(pool.canComplete());

        pool.complete();

        assertFalse(pool.canComplete());
    }
}
