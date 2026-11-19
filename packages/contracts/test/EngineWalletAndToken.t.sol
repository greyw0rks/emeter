// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EngineFixture} from "./helpers/EngineFixture.sol";
import {EmeterVault} from "../src/EmeterVault.sol";
import {TestContractWallet, TestFeeToken} from "./mocks/EngineMocks.sol";

contract EngineWalletAndTokenTest is EngineFixture {
    function testContractWalletCanAuthorizeCappedSession() public {
        TestContractWallet wallet = new TestContractWallet(customer);
        vm.startPrank(customer);
        token.approve(address(vault), 200_000);
        vault.depositFor(address(wallet), 200_000);
        vm.stopPrank();
        EmeterVault.SessionAuthorization memory grant = _grant(address(wallet), delegate, 1);
        bytes32 id = vault.createSession(grant, serviceIds, _sign(customerKey, vault.sessionAuthorizationDigest(grant)));
        vault.settle(_evidence(id, serviceA, 1, 1));
        EmeterVault.SettlementEvidence memory second = _ownerOverride(_evidence(id, serviceB, 1, 2), 70_000, customerKey);
        vault.settle(second);
        assertEq(vault.getSession(id).spent, 70_000);
        assertEq(vault.getSession(id).customer, address(wallet));
    }

    function testSponsoredDepositDoesNotGiveSponsorSpendingAuthority() public {
        vm.startPrank(customer);
        token.approve(address(vault), 200_000);
        vault.depositFor(customerTwo, 200_000);
        vm.stopPrank();
        EmeterVault.SessionAuthorization memory grant = _grant(customerTwo, delegateTwo, 1);
        bytes memory wrong = _sign(customerKey, vault.sessionAuthorizationDigest(grant));
        vm.expectRevert(EmeterVault.InvalidSessionSignature.selector);
        vault.createSession(grant, serviceIds, wrong);
        bytes32 id = vault.createSession(grant, serviceIds, _sign(customerTwoKey, vault.sessionAuthorizationDigest(grant)));
        assertEq(vault.getSession(id).customer, customerTwo);
    }

    function testFeeOnTransferDepositFailsWithoutCredit() public {
        TestFeeToken feeToken = new TestFeeToken();
        EmeterVault feeVault = new EmeterVault(feeToken, registry, adapter);
        feeToken.mint(customer, 200_000);
        feeToken.setFee(true);
        vm.startPrank(customer);
        feeToken.approve(address(feeVault), 200_000);
        vm.expectRevert(EmeterVault.UnsupportedTokenTransfer.selector);
        feeVault.deposit(200_000);
        vm.stopPrank();
        assertEq(feeVault.totalAvailable(), 0);
        assertEq(feeToken.balanceOf(address(feeVault)), 0);
        assertEq(feeToken.balanceOf(customer), 200_000);
    }

    function testFeeOnTransferPayoutRollsBackNonceAndSpending() public {
        TestFeeToken feeToken = new TestFeeToken();
        EmeterVault feeVault = new EmeterVault(feeToken, registry, adapter);
        feeToken.mint(customer, 200_000);
        vm.startPrank(customer);
        feeToken.approve(address(feeVault), 200_000);
        feeVault.deposit(200_000);
        vm.stopPrank();
        EmeterVault savedVault = vault;
        vault = feeVault;
        bytes32 id = _session(1);
        EmeterVault.SettlementEvidence memory evidence = _evidence(id, serviceA, 1, 1);
        feeToken.setFee(true);
        vm.expectRevert(EmeterVault.UnsupportedTokenTransfer.selector);
        vault.settle(evidence);
        assertFalse(vault.consumedChargeNonces(id, 1));
        assertEq(vault.getSession(id).spent, 0);
        assertEq(feeToken.balanceOf(payout), 0);
        assertEq(vault.totalLocked(), 200_000);
        vault = savedVault;
    }
}
