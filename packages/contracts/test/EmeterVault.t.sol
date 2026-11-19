// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EngineFixture} from "./helpers/EngineFixture.sol";
import {EmeterVault} from "../src/EmeterVault.sol";

contract EmeterVaultTest is EngineFixture {
    function testCustomerGrantLocksOnlySignedBudgetAndServiceList() public {
        bytes32 id = _session(1);
        EmeterVault.Session memory session = vault.getSession(id);
        assertEq(session.customer, customer);
        assertEq(session.signer, delegate);
        assertEq(session.balance, 200_000);
        assertEq(vault.availableBalance(customer), 300_000);
        assertEq(vault.totalLocked(), 200_000);
        assertEq(vault.totalAvailable(), 300_000);
        assertTrue(vault.sessionServiceAllowed(id, serviceA));
        assertTrue(vault.sessionServiceAllowed(id, serviceB));
    }

    function testSessionGrantCannotBeReplayedOrExpanded() public {
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, 1);
        bytes memory signature = _sign(customerKey, vault.sessionAuthorizationDigest(grant));
        vault.createSession(grant, serviceIds, signature);
        vm.expectRevert(EmeterVault.SessionNonceConsumed.selector);
        vault.createSession(grant, serviceIds, signature);
        grant.nonce = 2;
        grant.budget = 300_000;
        vm.expectRevert(EmeterVault.InvalidSessionSignature.selector);
        vault.createSession(grant, serviceIds, signature);
        assertEq(vault.totalLocked(), 200_000);
    }

    function testServiceSetIsSignedAndCanonical() public {
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, 1);
        bytes memory signature = _sign(customerKey, vault.sessionAuthorizationDigest(grant));
        bytes32[] memory subset = new bytes32[](1);
        subset[0] = serviceA;
        vm.expectRevert(EmeterVault.InvalidServiceSet.selector);
        vault.createSession(grant, subset, signature);
        grant.serviceSetHash = keccak256(abi.encode(subset));
        vm.expectRevert(EmeterVault.InvalidSessionSignature.selector);
        vault.createSession(grant, subset, signature);
        bytes32[] memory duplicates = new bytes32[](2);
        duplicates[0] = serviceA;
        duplicates[1] = serviceA;
        grant.serviceSetHash = keccak256(abi.encode(duplicates));
        signature = _sign(customerKey, vault.sessionAuthorizationDigest(grant));
        vm.expectRevert(EmeterVault.InvalidServiceSet.selector);
        vault.createSession(grant, duplicates, signature);
    }

    function testDelegatedChargeSettlesThroughPolicy() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        (uint256 price, uint8 inputs, bool allowed) = vault.previewSettlement(evidence);
        assertEq(price, 20_000);
        assertEq(inputs, 31);
        assertTrue(allowed);
        vault.settle(evidence);
        assertEq(token.balanceOf(payout), 20_000);
        assertEq(vault.getSession(id).spent, 20_000);
        assertEq(vault.totalPaid(), 20_000);
        assertEq(vault.totalLocked(), 180_000);
    }

    function testDelegateCannotOverrideSoftLimit() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceB, 1, 2);
        evidence = _ownerOverride(evidence, 70_000, delegateKey);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(15)));
        vault.settle(evidence);
        assertEq(vault.getSession(id).spent, 20_000);
        assertFalse(vault.consumedChargeNonces(id, 2));
    }

    function testExactCustomerOverrideAllowsSoftLimitCrossing() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory evidence = _ownerOverride(_evidence(id, serviceB, 1, 2), 70_000, customerKey);
        (, uint8 inputs, bool allowed) = vault.previewSettlement(evidence);
        assertEq(inputs, 47);
        assertTrue(allowed);
        vault.settle(evidence);
        assertEq(vault.getSession(id).spent, 70_000);
        assertEq(token.balanceOf(payoutTwo), 50_000);
    }

    function testCustomerOverrideDoesNotApplyToAnotherCharge() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory original = _ownerOverride(_evidence(id, serviceB, 1, 2), 70_000, customerKey);
        EmeterVault.SettlementEvidence memory other = _evidence(id, serviceB, 1, 3);
        other.softLimitOverride = original.softLimitOverride;
        other.customerOverrideSignature = original.customerOverrideSignature;
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(15)));
        vault.settle(other);
    }

    function testCustomerOverrideRespectsCumulativeCap() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory evidence = _ownerOverride(_evidence(id, serviceB, 1, 2), 69_999, customerKey);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(15)));
        vault.settle(evidence);
    }

    function testOldPriceAndSignerRemainBoundAfterNewVersion() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory old = _evidence(id, serviceA, 1, 1);
        vm.prank(provider);
        registry.publishPriceVersion(serviceA, payoutTwo, signerTwo, container, 30_000, keccak256("version two"));
        vault.settle(old);
        assertEq(token.balanceOf(payout), 20_000);
        assertEq(token.balanceOf(payoutTwo), 0);
        EmeterVault.SettlementEvidence memory next = _evidence(id, serviceA, 2, 2);
        next.providerSignature = _receiptSignature(next, signerTwoKey);
        vault.settle(next);
        assertEq(token.balanceOf(payoutTwo), 30_000);
        assertEq(vault.getSession(id).spent, 50_000);
    }

    function testChangingSignedVersionOrPriceFails() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        vm.prank(provider);
        registry.publishPriceVersion(serviceA, payout, signer, container, 30_000, keccak256("next"));
        evidence.authorization.priceVersion = 2;
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(27)));
        vault.settle(evidence);
        evidence = _evidence(id, serviceA, 1, 2);
        evidence.authorization.maxAmount = 19_999;
        evidence.chargeSignature = _sign(delegateKey, vault.chargeAuthorizationDigest(evidence.authorization));
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(27)));
        vault.settle(evidence);
    }

    function testDuplicateNonceRequestAndReceiptCannotSettleTwice() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        vault.settle(evidence);
        vm.expectRevert(EmeterVault.ChargeConsumed.selector);
        vault.settle(evidence);
        evidence.authorization.nonce = 2;
        evidence.chargeSignature = _sign(delegateKey, vault.chargeAuthorizationDigest(evidence.authorization));
        vm.expectRevert(EmeterVault.ChargeConsumed.selector);
        vault.settle(evidence);

        bytes32 other = _session(2);
        evidence.authorization.sessionId = other;
        evidence.chargeSignature = _sign(delegateKey, vault.chargeAuthorizationDigest(evidence.authorization));
        vm.expectRevert(EmeterVault.ChargeConsumed.selector);
        vault.settle(evidence);
        assertEq(vault.totalPaid(), 20_000);
    }

    function testWrongKeyAndChainOrVaultSignaturesDenied() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        evidence.chargeSignature = _sign(customerKey, vault.chargeAuthorizationDigest(evidence.authorization));
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(27)));
        vault.settle(evidence);
        evidence = _evidence(id, serviceA, 1, 1);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(27)));
        vault.settle(evidence);
        vm.chainId(block.chainid - 1);
        EmeterVault other = new EmeterVault(token, registry, adapter);
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, 9);
        bytes memory originalVaultSignature = _sign(customerKey, vault.sessionAuthorizationDigest(grant));
        vm.expectRevert(EmeterVault.InvalidSessionSignature.selector);
        other.createSession(grant, serviceIds, originalVaultSignature);
    }

    function testProviderErrorAndInvalidReceiptSignaturesDenied() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        evidence.receipt.ok = false;
        evidence.providerSignature = _receiptSignature(evidence, signerKey);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(29)));
        vault.settle(evidence);
        evidence = _evidence(id, serviceA, 1, 1);
        evidence.providerSignature = hex"00";
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(29)));
        vault.settle(evidence);
        assertEq(vault.totalPaid(), 0);
    }

    function testReceiptMustMatchTheBoundRequest() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        evidence.receipt.requestHash = keccak256("another request");
        evidence.providerSignature = _receiptSignature(evidence, signerKey);
        vm.expectRevert(EmeterVault.ReceiptBindingFailed.selector);
        vault.settle(evidence);
    }

    function testPerRequestCapCannotBeOverridden() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        evidence.authorization.maxAmount = 50_001;
        evidence.chargeSignature = _sign(delegateKey, vault.chargeAuthorizationDigest(evidence.authorization));
        evidence = _ownerOverride(evidence, 200_000, customerKey);
        vm.expectRevert(EmeterVault.HardBudgetExceeded.selector);
        vault.settle(evidence);
    }

    function testSessionBudgetCannotBeOverriddenOrBorrowFromAvailableCredit() public {
        bytes32 id = _session(1);
        for (uint256 nonce = 1; nonce <= 4; ++nonce) {
            vault.settle(_ownerOverride(_evidence(id, serviceB, 1, nonce), nonce * 50_000, customerKey));
        }
        EmeterVault.SettlementEvidence memory next = _ownerOverride(_evidence(id, serviceB, 1, 5), 200_000, customerKey);
        vm.expectRevert(EmeterVault.HardBudgetExceeded.selector);
        vault.settle(next);
        assertEq(vault.getSession(id).spent, 200_000);
        assertEq(vault.availableBalance(customer), 300_000);
    }

    function testSessionOnlyAllowsSignedServiceIds() public {
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, 1);
        bytes32[] memory onlyA = new bytes32[](1);
        onlyA[0] = serviceA;
        grant.serviceSetHash = keccak256(abi.encode(onlyA));
        bytes32 id = vault.createSession(grant, onlyA, _sign(customerKey, vault.sessionAuthorizationDigest(grant)));
        EmeterVault.SettlementEvidence memory wrongService = _evidence(id, serviceB, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(30)));
        vault.settle(wrongService);
    }

    function testRevokedProviderAndVersionCannotBeOverridden() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _ownerOverride(_evidence(id, serviceA, 1, 1), 20_000, customerKey);
        vm.prank(provider);
        registry.setVersionEnabled(serviceA, 1, false);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(62)));
        vault.settle(evidence);
        vm.prank(provider);
        registry.setVersionEnabled(serviceA, 1, true);
        vm.prank(administrator);
        registry.setProviderAllowed(provider, false);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(62)));
        vault.settle(evidence);
    }

    function testClosePreservesOutstandingSettlementAndOriginalRefundDeadline() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory pending = _evidence(id, serviceA, 1, 1);
        uint64 refundAt = vault.getSession(id).refundAfter;
        vm.warp(block.timestamp + 1);
        vm.prank(customer);
        vault.closeSession(id);
        assertEq(vault.getSession(id).refundAfter, refundAt);
        vm.expectRevert(EmeterVault.RefundLocked.selector);
        vault.refund(id);
        vault.settle(pending);
        vm.warp(block.timestamp + 1);
        EmeterVault.SettlementEvidence memory newRequest = _evidence(id, serviceA, 1, 2);
        vm.expectRevert(EmeterVault.AuthorizationExpired.selector);
        vault.settle(newRequest);
    }

    function testSignerRevocationStopsPendingChargesWithoutUnlockingFunds() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory pending = _evidence(id, serviceA, 1, 1);
        vm.prank(customer);
        vault.revokeSessionSigner(id);
        vm.expectRevert(EmeterVault.SessionUnavailable.selector);
        vault.settle(pending);
        vm.expectRevert(EmeterVault.RefundLocked.selector);
        vault.refund(id);
        assertEq(vault.totalLocked(), 200_000);
    }

    function testSettlementWindowAcceptsRecentPreExpiryWork() public {
        bytes32 id = _session(1);
        uint64 expiry = vault.getSession(id).expiresAt;
        vm.warp(expiry - 1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        vm.warp(expiry + 20);
        vault.settle(evidence);
        assertEq(vault.getSession(id).spent, 20_000);
        evidence = _evidence(id, serviceA, 1, 2);
        vm.expectRevert(EmeterVault.AuthorizationExpired.selector);
        vault.settle(evidence);
    }

    function testRefundReturnsReservedFundsToCustomerOnly() public {
        bytes32 id = _session(1);
        vault.settle(_evidence(id, serviceA, 1, 1));
        vm.warp(vault.getSession(id).refundAfter);
        vm.prank(administrator); // A relayer may trigger, never redirect, the refund.
        vault.refund(id);
        assertEq(token.balanceOf(customer), 680_000);
        assertEq(token.balanceOf(payout), 20_000);
        assertEq(vault.totalLocked(), 0);
        assertEq(vault.getSession(id).refundedAmount, 180_000);
        vm.expectRevert(EmeterVault.SessionUnavailable.selector);
        vault.refund(id);
        vm.prank(customer);
        vault.withdrawAvailable(300_000);
        assertEq(token.balanceOf(customer), 980_000);
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function testRegistryAdministratorCannotSpendOrWithdrawCustomerCredit() public {
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, 1);
        bytes memory forged = _sign(delegateKey, vault.sessionAuthorizationDigest(grant));
        vm.prank(administrator);
        vm.expectRevert(EmeterVault.InvalidSessionSignature.selector);
        vault.createSession(grant, serviceIds, forged);
        vm.prank(administrator);
        vm.expectRevert(EmeterVault.InvalidAmount.selector);
        vault.withdrawAvailable(1);
        bytes32 id = _session(1);
        vm.prank(administrator);
        vm.expectRevert(EmeterVault.UnauthorizedCustomer.selector);
        vault.closeSession(id);
    }

    function testDifferentCustomersAndSessionsKeepBudgetsSeparate() public {
        bytes32 first = _session(1);
        vm.startPrank(customerTwo);
        token.approve(address(vault), 200_000);
        vault.deposit(200_000);
        vm.stopPrank();
        EmeterVault.SessionAuthorization memory grant = _grant(customerTwo, delegateTwo, 1);
        bytes32 second = vault.createSession(grant, serviceIds, _sign(customerTwoKey, vault.sessionAuthorizationDigest(grant)));
        vault.settle(_evidence(first, serviceA, 1, 1));
        vault.settle(_evidence(second, serviceB, 1, 1));
        assertEq(vault.getSession(first).spent, 20_000);
        assertEq(vault.getSession(second).spent, 50_000);
        assertEq(vault.totalLocked(), 330_000);
    }

    function testProcessorAndAdapterFailuresCannotTransferTokens() public {
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        mockProcessor.setMode(5);
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(31)));
        vault.settle(evidence);
        mockProcessor.setMode(0);
        vm.etch(address(adapter), hex"");
        vm.expectRevert(abi.encodeWithSelector(EmeterVault.PolicyDenied.selector, uint8(31)));
        vault.settle(evidence);
        assertEq(vault.getSession(id).balance, 200_000);
    }

    function testFuzzRefundAndPaymentConservation(uint8 count) public {
        bytes32 id = _session(1);
        uint256 charges = bound(count, 0, 4);
        for (uint256 nonce = 1; nonce <= charges; ++nonce) {
            vault.settle(_ownerOverride(_evidence(id, serviceB, 1, nonce), nonce * 50_000, customerKey));
        }
        EmeterVault.Session memory session = vault.getSession(id);
        assertEq(session.balance + session.spent, session.budget);
        assertEq(token.balanceOf(address(vault)), vault.totalAvailable() + vault.totalLocked());
        vm.warp(session.refundAfter);
        vault.refund(id);
        vm.prank(customer);
        vault.withdrawAvailable(300_000);
        assertEq(token.balanceOf(customer) + token.balanceOf(payoutTwo), 1_000_000);
    }
}
