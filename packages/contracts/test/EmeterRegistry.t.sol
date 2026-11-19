// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EngineFixture} from "./helpers/EngineFixture.sol";
import {EmeterRegistry} from "../src/EmeterRegistry.sol";

contract EmeterRegistryTest is EngineFixture {
    function testAllowlistedProviderRegistersImmutableTerms() public view {
        EmeterRegistry.Service memory service = registry.getService(serviceA);
        EmeterRegistry.PriceVersion memory terms = registry.getPriceVersion(serviceA, 1);
        assertEq(service.provider, provider);
        assertEq(service.latestVersion, 1);
        assertEq(terms.price, 20_000);
        assertEq(terms.signer, signer);
        assertEq(terms.payout, payout);
        assertTrue(registry.isServiceAuthorized(serviceA, 1));
        assertEq(registry.serviceCount(), 2);
    }

    function testUnallowlistedProviderCannotRegister() public {
        vm.prank(customer);
        vm.expectRevert(EmeterRegistry.ProviderNotAllowed.selector);
        registry.registerService(keccak256("new service"), payout, signer, container, 1, keccak256("metadata"));
    }

    function testOnlyProviderCanPublishNewPrice() public {
        vm.prank(administrator);
        vm.expectRevert(EmeterRegistry.UnauthorizedProvider.selector);
        registry.publishPriceVersion(serviceA, payout, signer, container, 30_000, keccak256("new metadata"));
    }

    function testVersionChangePreservesOldPriceSignerAndPayout() public {
        vm.prank(provider);
        uint32 version = registry.publishPriceVersion(serviceA, payoutTwo, signerTwo, container, 30_000, keccak256("new metadata"));
        assertEq(version, 2);
        EmeterRegistry.PriceVersion memory old = registry.getPriceVersion(serviceA, 1);
        assertEq(old.price, 20_000);
        assertEq(old.signer, signer);
        assertEq(old.payout, payout);
        assertTrue(registry.isServiceAuthorized(serviceA, 1));
        assertEq(registry.getPriceVersion(serviceA, 2).price, 30_000);
    }

    function testOwnerAndProviderCanPauseWithoutChangingTerms() public {
        vm.prank(administrator);
        registry.setServiceEnabled(serviceA, false);
        assertFalse(registry.isServiceAuthorized(serviceA, 1));
        assertEq(registry.getPriceVersion(serviceA, 1).price, 20_000);
        vm.prank(provider);
        registry.setServiceEnabled(serviceA, true);
        assertTrue(registry.isServiceAuthorized(serviceA, 1));
        vm.prank(customer);
        vm.expectRevert(EmeterRegistry.UnauthorizedProvider.selector);
        registry.setServiceEnabled(serviceA, false);
    }

    function testSignerVersionCanBeRevoked() public {
        vm.prank(provider);
        registry.publishPriceVersion(serviceA, payoutTwo, signerTwo, container, 30_000, keccak256("next"));
        vm.prank(provider);
        registry.setVersionEnabled(serviceA, 1, false);
        assertFalse(registry.isServiceAuthorized(serviceA, 1));
        assertTrue(registry.isServiceAuthorized(serviceA, 2));
        assertEq(registry.getPriceVersion(serviceA, 1).signer, signer);
    }

    function testProviderRevocationDisablesAllItsServices() public {
        vm.prank(administrator);
        registry.setProviderAllowed(provider, false);
        assertFalse(registry.isServiceAuthorized(serviceA, 1));
        assertFalse(registry.isServiceAuthorized(serviceB, 1));
        vm.prank(provider);
        vm.expectRevert(EmeterRegistry.ProviderNotAllowed.selector);
        registry.publishPriceVersion(serviceA, payout, signer, container, 10, keccak256("new"));
    }

    function testRejectsDuplicateAndZeroTerms() public {
        vm.startPrank(provider);
        vm.expectRevert(EmeterRegistry.ServiceAlreadyExists.selector);
        registry.registerService(serviceA, payout, signer, container, 1, keccak256("metadata"));
        vm.expectRevert(EmeterRegistry.InvalidService.selector);
        registry.registerService(bytes32(0), payout, signer, container, 1, keccak256("metadata"));
        vm.expectRevert(EmeterRegistry.InvalidService.selector);
        registry.registerService(keccak256("bad price"), payout, signer, container, 0, keccak256("metadata"));
        vm.expectRevert(EmeterRegistry.InvalidService.selector);
        registry.registerService(keccak256("bad signer"), payout, address(0), container, 1, keccak256("metadata"));
        vm.stopPrank();
    }

    function testUnknownVersionCannotAuthorize() public view {
        assertFalse(registry.isServiceAuthorized(serviceA, 0));
        assertFalse(registry.isServiceAuthorized(serviceA, 99));
        assertFalse(registry.isServiceAuthorized(keccak256("unknown"), 1));
    }
}
