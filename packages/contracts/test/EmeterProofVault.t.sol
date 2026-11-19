// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {DemoUSD} from "../src/DemoUSD.sol";
import {EmeterPolicyAdapter} from "../src/EmeterPolicyAdapter.sol";
import {EmeterProofVault} from "../src/EmeterProofVault.sol";
import {Tap13Receipt} from "../src/Tap13Receipt.sol";
import {MockFactory, MockBeacon, MockProcessor} from "./mocks/MockTapeOut.sol";

contract EmeterProofVaultTest is Test {
    DemoUSD internal token;
    EmeterPolicyAdapter internal adapter;
    EmeterProofVault internal vault;
    MockProcessor internal processor;
    address internal customer;
    uint256 internal customerKey;
    address internal signer;
    uint256 internal signerKey;
    address internal provider;
    address internal container;
    bytes32 internal serviceId;
    uint64 internal expiry;

    function setUp() public virtual {
        vm.warp(1_900_000_000);
        (customer, customerKey) = makeAddrAndKey("emeter-test-customer");
        (signer, signerKey) = makeAddrAndKey("emeter-test-provider");
        provider = makeAddr("emeter-provider-payout");
        container = makeAddr("proof-only-container-identifier");
        serviceId = keccak256("emeter-proof-service");
        expiry = uint64(block.timestamp + 600);
        MockFactory factory = new MockFactory();
        processor = new MockProcessor(address(factory));
        factory.register(address(processor), true);
        MockBeacon beacon = new MockBeacon(address(processor));
        adapter = new EmeterPolicyAdapter(address(factory), address(processor), 1, address(beacon));
        token = new DemoUSD(address(this));
        token.mint(customer, 1_000_000);
        vault = new EmeterProofVault(token, adapter, _configuration());
        vm.startPrank(customer);
        token.approve(address(vault), 200_000);
        vault.deposit(200_000);
        vm.stopPrank();
    }

    function _configuration() internal view returns (EmeterProofVault.Configuration memory) {
        return EmeterProofVault.Configuration({
            customer: customer, provider: provider, providerSigner: signer, serviceContainer: container,
            serviceId: serviceId, price: 50_000, hardBudget: 200_000, softLimit: 50_000,
            expiresAt: expiry, settlementWindow: 300
        });
    }

    function _authorization(uint256 nonce, bool overrideLimit)
        internal
        view
        returns (EmeterProofVault.ChargeAuthorization memory)
    {
        return EmeterProofVault.ChargeAuthorization({
            requestId: keccak256(abi.encode("request", nonce)),
            requestHash: keccak256(abi.encode("canonical request", nonce)),
            serviceId: serviceId, maxAmount: 50_000, nonce: nonce,
            validUntil: expiry + 300, overrideSoftLimit: overrideLimit
        });
    }

    function _receipt(EmeterProofVault.ChargeAuthorization memory auth)
        internal
        view
        returns (Tap13Receipt.Receipt memory)
    {
        return Tap13Receipt.Receipt({
            requestId: auth.requestId, requestHash: auth.requestHash,
            bodyHash: keccak256("test-only canonical result"), timestamp: uint64(block.timestamp), ok: true
        });
    }

    function _signature(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _providerSignature(Tap13Receipt.Receipt memory receipt) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "TAPI-1/resp/v2", container, receipt.requestId, receipt.requestHash,
                receipt.ok ? bytes1(0x01) : bytes1(0x00), receipt.bodyHash, receipt.timestamp
            )
        );
        return _signature(signerKey, MessageHashUtils.toEthSignedMessageHash(digest));
    }

    function _settle(uint256 nonce, bool overrideLimit) internal {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(nonce, overrideLimit);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        vault.settle(auth, _signature(customerKey, vault.authorizationDigest(auth)), receipt, _providerSignature(receipt));
    }

    function testAuthorizedPaymentSettles() public {
        _settle(1, false);
        assertEq(token.balanceOf(provider), 50_000);
        assertEq(vault.balance(), 150_000);
        assertEq(vault.spent(), 50_000);
        assertTrue(vault.consumedNonces(1));
        assertTrue(vault.consumedRequests(_authorization(1, false).requestId));
    }

    function testCircuitDenialLeavesPaymentAndNonceUnchanged() public {
        _settle(1, false);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(2, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(0x0f)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(token.balanceOf(provider), 50_000);
        assertEq(vault.balance(), 150_000);
        assertFalse(vault.consumedNonces(2));
    }

    function testExplicitSignedOverrideAllowsSoftLimitOnly() public {
        _settle(1, false);
        _settle(2, true);
        assertEq(token.balanceOf(provider), 100_000);
        assertEq(vault.spent(), 100_000);
    }

    function testForgedOverrideIsNotTrusted() public {
        _settle(1, false);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(2, false);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        auth.overrideSoftLimit = true;
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(11)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(token.balanceOf(provider), 50_000);
    }

    function testProviderFailureIsNotCharged() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        receipt.ok = false;
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(29)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(vault.spent(), 0);
    }

    function testForgedProviderOrCustomerSignaturesDenied() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(27)));
        vault.settle(auth, hex"00", receipt, providerSignature);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(29)));
        vault.settle(auth, customerSignature, receipt, hex"00");
        assertEq(token.balanceOf(provider), 0);
    }

    function testChangingServiceOrMaximumPriceDenied() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        auth.serviceId = keccak256("different service");
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(30)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        auth.serviceId = serviceId;
        auth.maxAmount = 49_999;
        customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(27)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testDuplicateRequestAndNonceRejected() public {
        _settle(1, false);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, true);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.AlreadyConsumed.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);

        auth.requestId = keccak256("different request, same nonce");
        receipt = _receipt(auth);
        customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.AlreadyConsumed.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testReceiptBoundToAuthorizedRequest() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        receipt.requestHash = keccak256("different request");
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.ReceiptBindingFailed.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testAuthorizationBoundToChainAndVault() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(27)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        vm.chainId(block.chainid - 1);
        EmeterProofVault otherVault = new EmeterProofVault(token, adapter, _configuration());
        vm.startPrank(customer);
        token.approve(address(otherVault), 100_000);
        otherVault.deposit(100_000);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(27)));
        otherVault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testHardBudgetCannotBeOverridden() public {
        for (uint256 nonce = 1; nonce <= 4; ++nonce) _settle(nonce, true);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(5, true);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.HardBudgetExceeded.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(token.balanceOf(provider), 200_000);
        assertEq(vault.balance(), 0);
    }

    function testExpiredAuthorizationRejected() public {
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        auth.validUntil = uint64(block.timestamp - 1);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.AuthorizationExpired.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testReceiptReportedAfterExecutionExpiryRejected() public {
        vm.warp(expiry + 1);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(EmeterProofVault.ReceiptExpired.selector);
        vault.settle(auth, customerSignature, receipt, providerSignature);
    }

    function testLockedWindowPermitsOutstandingSettlement() public {
        vm.warp(expiry - 1);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.warp(expiry + 10);
        vm.prank(customer);
        vm.expectRevert(EmeterProofVault.RefundLocked.selector);
        vault.refund();
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(token.balanceOf(provider), 50_000);
    }

    function testSafeRefundReturnsOnlyUnusedFunds() public {
        _settle(1, false);
        vm.prank(customer);
        vm.expectRevert(EmeterProofVault.RefundLocked.selector);
        vault.refund();
        vm.warp(vault.refundAfter());
        vm.prank(customer);
        vault.refund();
        assertEq(token.balanceOf(customer), 950_000);
        assertEq(token.balanceOf(provider), 50_000);
        assertEq(vault.balance(), 0);
        assertTrue(vault.refunded());
        vm.prank(customer);
        vm.expectRevert(EmeterProofVault.FundingClosed.selector);
        vault.deposit(1);
    }

    function testProcessorFailureCannotTransferFunds() public {
        processor.setMode(5);
        EmeterProofVault.ChargeAuthorization memory auth = _authorization(1, false);
        Tap13Receipt.Receipt memory receipt = _receipt(auth);
        bytes memory customerSignature = _signature(customerKey, vault.authorizationDigest(auth));
        bytes memory providerSignature = _providerSignature(receipt);
        vm.expectRevert(abi.encodeWithSelector(EmeterProofVault.PolicyDenied.selector, uint8(31)));
        vault.settle(auth, customerSignature, receipt, providerSignature);
        assertEq(vault.balance(), 200_000);
        assertEq(token.balanceOf(provider), 0);
    }

    function testDemoMintRestrictedAndCapped() public {
        vm.prank(customer);
        vm.expectRevert(DemoUSD.UnauthorizedMinter.selector);
        token.mint(customer, 1);
        uint256 tooMuch = token.MAX_SUPPLY();
        vm.expectRevert(DemoUSD.DemoSupplyExceeded.selector);
        token.mint(customer, tooMuch);
    }

    function testFuzzSpendingAndRefundConservation(uint8 count) public {
        uint256 requests = bound(count, 0, 4);
        for (uint256 nonce = 1; nonce <= requests; ++nonce) _settle(nonce, true);
        assertEq(vault.spent() + vault.balance(), 200_000);
        assertEq(token.balanceOf(provider), vault.spent());
        vm.warp(vault.refundAfter());
        vm.prank(customer);
        vault.refund();
        assertEq(token.balanceOf(customer) + token.balanceOf(provider), 1_000_000);
        assertEq(token.balanceOf(address(vault)), 0);
    }
}
