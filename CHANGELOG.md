# Changelog

## [2.1.0](https://github.com/CourtHive/competition-factory-server/compare/v2.0.2...v2.1.0) (2026-05-16)


### Features

* **admin-client:** settings redesign + templates + policies catalogs ([#605](https://github.com/CourtHive/competition-factory-server/issues/605)) ([09b57ee](https://github.com/CourtHive/competition-factory-server/commit/09b57ee5f652fd18ce24fa9d845a83b592b4590d))
* **admin:** boot-time version + build banner in browser console ([1994f9d](https://github.com/CourtHive/competition-factory-server/commit/1994f9dbe8d3fc849c3ee43bb635a5c0fe4b2fe7))
* **admin:** invite UI handles existing-email branch + providerRole picker ([2a9457e](https://github.com/CourtHive/competition-factory-server/commit/2a9457e0f55ebb943e615fe9e886d7e4e7c10603))
* **admin:** multi-provider associations panel on Edit User modal ([f3fff3d](https://github.com/CourtHive/competition-factory-server/commit/f3fff3d15bcb440a64ca871a469e36d4e33fee9f))
* **auth:** provider admin implies tournament delete ([7284ff5](https://github.com/CourtHive/competition-factory-server/commit/7284ff571052616887f34cf0d3b5134015271cf8))
* **auth:** provider-scoped admin reset + self-service change-password ([b49d044](https://github.com/CourtHive/competition-factory-server/commit/b49d044aacdd7066a39f264270bae9bf0ac420ae))
* **auth:** provider-scoped admin reset + self-service change-password ([e402aee](https://github.com/CourtHive/competition-factory-server/commit/e402aee07cdbd7146dd3f529ea665a0ce8d2b126))
* **errors:** propagate factory error context through REST + WS boundaries ([7e62ca7](https://github.com/CourtHive/competition-factory-server/commit/7e62ca7838a045a61a811a21a8ebbe3ed07e2f64))
* **i18n:** add CFS i18n module — manifest + locale endpoints ([1350771](https://github.com/CourtHive/competition-factory-server/commit/135077178edab22e038ec7ea06579b3f3cd01c0a))
* **i18n:** add POST /admin/i18n/refresh for hot-reload from disk ([b97d1d4](https://github.com/CourtHive/competition-factory-server/commit/b97d1d4f27a7f7074645cf8cf4530eaca5c6a6ce))
* **privacy:** provider-owned participantPrivacy + admin-client UI ([7e6dcdd](https://github.com/CourtHive/competition-factory-server/commit/7e6dcdd61f8467792c26bfa516e1a713e4a3bc42))
* **projectors:** matchup-finalized consumer for score-relay (Phase 3 slice 6) ([2cf2e26](https://github.com/CourtHive/competition-factory-server/commit/2cf2e261a30fd0c83c37e300f0bbb01f35c57eb4))
* **provider-config:** add printPolicies to ProviderPolicyDefaults ([c8349b8](https://github.com/CourtHive/competition-factory-server/commit/c8349b81a6a289df1769ee9c30aef47769ac5cb1))
* **provider-config:** consume @courthive/provider-config + executionQueue gating ([d7779ac](https://github.com/CourtHive/competition-factory-server/commit/d7779acefd4c8651300490924e30725f44e399b1))
* **providers:** granular participantPrivacy cap + getParticipants relaxation ([ed4bfa8](https://github.com/CourtHive/competition-factory-server/commit/ed4bfa8af5604282b7e219de7c116307e3cd0378))
* **provisioner:** user-provider association REST endpoints + invite-existing-email ([af74438](https://github.com/CourtHive/competition-factory-server/commit/af74438e8b7dc8294f84a90e05aca3aae0057e08))
* **rankings-webhook:** add CFS outbound webhook to courthive-rankings ([3ae08f9](https://github.com/CourtHive/competition-factory-server/commit/3ae08f9e32b82fc9c60eeeedd7e42d22ec393273))


### Bug Fixes

* **admin-client:** approve esbuild build script ([9655fb4](https://github.com/CourtHive/competition-factory-server/commit/9655fb4a39b4f37983b9364452be40a112644ac4))
* **admin:** pre-sort providers + users by lastAccess before Tabulator ([31ede5d](https://github.com/CourtHive/competition-factory-server/commit/31ede5d2bc8dcbb68656bf6dc47d69f7a69876ea))
* **admin:** re-apply lastAccess sort on tableBuilt ([ad3886c](https://github.com/CourtHive/competition-factory-server/commit/ad3886ceeb24955914aed8da7cdcbb25e3cb3de7))
* **admin:** rip out Tabulator initialSort — let pre-sorted data win ([57a8af3](https://github.com/CourtHive/competition-factory-server/commit/57a8af3b303779e5fad4d361eec8b59f348b7937))
* **admin:** show provider name (not UUID) in Edit User typeAhead ([b986f68](https://github.com/CourtHive/competition-factory-server/commit/b986f687d2cd361e7c8307a35b42ed10bfdf93af))
* **audit-worker:** replace axios with native fetch to stop Socket listener leak ([5e9bc81](https://github.com/CourtHive/competition-factory-server/commit/5e9bc8190a953527459193dfb3e3c82ea51b3ee1))
* pnpm 11 install — kebab-case .npmrc + ignoredBuiltDependencies ([0b48b74](https://github.com/CourtHive/competition-factory-server/commit/0b48b743ce1e2ad49c77f9f56f29405f7a5deb06))
* **sub-packages:** add pnpm.onlyBuiltDependencies to admin-client + audit-worker ([70c094d](https://github.com/CourtHive/competition-factory-server/commit/70c094da9f6c0ae65e67279ae42d8c33afd1c8d4))
* **sub-packages:** give admin-client + audit-worker their own .npmrc + workspace.yaml ([f383a03](https://github.com/CourtHive/competition-factory-server/commit/f383a033864c5c8b7eb39a7544d8dba5cabb1397))
* **test:** give each spec a unique tournamentId to stop parallel-worker races ([1925ec1](https://github.com/CourtHive/competition-factory-server/commit/1925ec1f40cb360b321c12dc4f894b80900a3679))
* **tests:** eliminate jest worker force-exit residual from CFS suite ([183cf24](https://github.com/CourtHive/competition-factory-server/commit/183cf246ad77c4e22c3fafa93ff981cab1a0ef4f))
* **test:** wire onModuleDestroy for PG_POOL, Keyv, and audit-prune timer ([5c3edfa](https://github.com/CourtHive/competition-factory-server/commit/5c3edfaaf3c1a8b4943b9065706a5b6644a0a1ca))
* **users:** normalize email to lowercase for case-insensitive auth ([cef5bc8](https://github.com/CourtHive/competition-factory-server/commit/cef5bc874f4d4e44a81a1c2ea5add21660fb85a2))


### Documentation

* **migrations:** document the -- AFFECTS: header convention ([f3a29e8](https://github.com/CourtHive/competition-factory-server/commit/f3a29e87ac963d533ab83c13e4c8d1d8d6e57042))
