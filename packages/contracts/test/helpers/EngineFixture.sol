// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {DemoUSD} from "../../src/DemoUSD.sol";
import {EmeterRegistry} from "../../src/EmeterRegistry.sol";
import {EmeterVault} from "../../src/EmeterVault.sol";
import {EmeterPolicyAdapter} from "../../src/EmeterPolicyAdapter.sol";
import {Tap13Receipt} from "../../src/Tap13Receipt.sol";
import {MockFactory, MockBeacon, MockProcessor} from "../mocks/MockTapeOut.sol";

abstract contract EngineFixture is Test {
    DemoUSD internal token;
    EmeterRegistry internal registry;
    EmeterVault internal vault;
    EmeterPolicyAdapter internal adapter;
    MockProcessor internal mockProcessor;
    address internal administrator;
    address internal provider;
    address internal customer;
    uint256 internal customerKey;
    address internal customerTwo;
    uint256 internal customerTwoKey;
    address internal delegate;
    uint256 internal delegateKey;
    address internal delegateTwo;
    uint256 internal delegateTwoKey;
    address internal signer;
    uint256 internal signerKey;
    address internal signerTwo;
    uint256 internal signerTwoKey;
    address internal payout;
    address internal payoutTwo;
    address internal container;
    bytes32 internal serviceA;
    bytes32 internal serviceB;
    bytes32[] internal serviceIds;

    function _deployToken() internal virtual returns (DemoUSD) { return new DemoUSD(address(this)); }
    function _fundToken() internal virtual {
        token.mint(customer, 1_000_000);
        token.mint(customerTwo, 1_000_000);
    }

    function _deployPolicy() internal virtual returns (EmeterPolicyAdapter) {
        MockFactory factory = new MockFactory();
        mockProcessor = new MockProcessor(address(factory));
        factory.register(address(mockProcessor), true);
        MockBeacon beacon = new MockBeacon(address(mockProcessor));
        return new EmeterPolicyAdapter(address(factory), address(mockProcessor), 1, address(beacon));
    }

    function setUp() public virtual {
        adapter = _deployPolicy();
        if (block.timestamp < 1_700_000_000) vm.warp(1_800_000_000);
        administrator = makeAddr("engine-admin");
        provider = makeAddr("engine-provider-owner");
        (customer, customerKey) = makeAddrAndKey("engine-customer-one");
        (customerTwo, customerTwoKey) = makeAddrAndKey("engine-customer-two");
        (delegate, delegateKey) = makeAddrAndKey("engine-delegate-one");
        (delegateTwo, delegateTwoKey) = makeAddrAndKey("engine-delegate-two");
        (signer, signerKey) = makeAddrAndKey("engine-provider-signing-key-one");
        (signerTwo, signerTwoKey) = makeAddrAndKey("engine-provider-signing-key-two");
        payout = makeAddr("engine-payout-one");
        payoutTwo = makeAddr("engine-payout-two");
        container = makeAddr("engine-test-container");
        serviceA = keccak256("engine-json-validator");
        serviceB = keccak256("engine-word-count");
        serviceIds.push(uint256(serviceA) < uint256(serviceB) ? serviceA : serviceB);
        serviceIds.push(uint256(serviceA) < uint256(serviceB) ? serviceB : serviceA);
        token = _deployToken();
        _fundToken();
        registry = new EmeterRegistry(administrator);
        vm.prank(administrator);
        registry.setProviderAllowed(provider, true);
        vm.startPrank(provider);
        registry.registerService(serviceA, payout, signer, container, 20_000, keccak256("JSON validation fixture"));
        registry.registerService(serviceB, payoutTwo, signerTwo, container, 50_000, keccak256("word count fixture"));
        vm.stopPrank();
        vault = new EmeterVault(token, registry, adapter);
        vm.startPrank(customer);
        token.approve(address(vault), 500_000);
        vault.deposit(500_000);
        vm.stopPrank();
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _grant(address owner, address key, uint256 nonce) internal view returns (EmeterVault.SessionAuthorization memory) {
        return EmeterVault.SessionAuthorization({
            customer: owner, signer: key, budget: 200_000, softLimit: 50_000, maxCharge: 50_000,
            expiresAt: uint64(block.timestamp + 600), settlementWindow: 300,
            serviceSetHash: keccak256(abi.encode(serviceIds)), nonce: nonce
        });
    }

    function _session(uint256 nonce) internal returns (bytes32) {
        EmeterVault.SessionAuthorization memory grant = _grant(customer, delegate, nonce);
        return vault.createSession(grant, serviceIds, _sign(customerKey, vault.sessionAuthorizationDigest(grant)));
    }

    function _evidence(bytes32 sessionId, bytes32 serviceId, uint32 version, uint256 nonce)
        internal view returns (EmeterVault.SettlementEvidence memory evidence) {
        EmeterVault.Session memory session = vault.getSession(sessionId);
        evidence.authorization = EmeterVault.ChargeAuthorization({
            sessionId: sessionId, requestId: keccak256(abi.encode("request", sessionId, serviceId, nonce)),
            requestHash: keccak256(abi.encode("canonical request", sessionId, serviceId, nonce)),
            serviceId: serviceId, priceVersion: version, maxAmount: 50_000, nonce: nonce,
            issuedAt: uint64(block.timestamp), validUntil: session.expiresAt
        });
        evidence.receipt = Tap13Receipt.Receipt({
            requestId: evidence.authorization.requestId, requestHash: evidence.authorization.requestHash,
            bodyHash: keccak256("test-only canonical response"), timestamp: uint64(block.timestamp), ok: true
        });
        evidence.chargeSignature = _sign(session.signer == delegate ? delegateKey : delegateTwoKey,
            vault.chargeAuthorizationDigest(evidence.authorization));
        evidence.providerSignature = _receiptSignature(evidence, serviceId == serviceA ? signerKey : signerTwoKey);
    }

    function _receiptSignature(EmeterVault.SettlementEvidence memory evidence, uint256 key) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(
            "TAPI-1/resp/v2", container, evidence.receipt.requestId, evidence.receipt.requestHash,
            evidence.receipt.ok ? bytes1(0x01) : bytes1(0x00), evidence.receipt.bodyHash, evidence.receipt.timestamp
        ));
        return _sign(key, MessageHashUtils.toEthSignedMessageHash(digest));
    }

    function _ownerOverride(EmeterVault.SettlementEvidence memory evidence, uint256 maxSpend, uint256 key)
        internal view returns (EmeterVault.SettlementEvidence memory) {
        evidence.softLimitOverride = EmeterVault.SoftLimitOverride({
            sessionId: evidence.authorization.sessionId,
            chargeDigest: vault.chargeAuthorizationDigest(evidence.authorization), maxTotalSpend: maxSpend,
            validUntil: vault.getSession(evidence.authorization.sessionId).refundAfter
        });
        evidence.customerOverrideSignature = _sign(key, vault.softLimitOverrideDigest(evidence.softLimitOverride));
        return evidence;
    }
}
