# Changelog

## [2.5.2](https://github.com/CourtHive/competition-factory-server/compare/v2.5.1...v2.5.2) (2026-05-24)


### Bug Fixes

* **admin:** dark-mode delete modal + drive footer buttons via cModal setButtonState ([364abda](https://github.com/CourtHive/competition-factory-server/commit/364abda4c570d97b0ed6197698e95c8dc6734079))

## [2.5.1](https://github.com/CourtHive/competition-factory-server/compare/v2.5.0...v2.5.1) (2026-05-24)


### Bug Fixes

* **admin-client:** keep unauthenticated /admin landing; add e2e role-routing ([6000519](https://github.com/CourtHive/competition-factory-server/commit/60005195310a511292125d4eca9d968b664fef96))
* **admin-client:** keep unauthenticated /admin landing; add e2e role-routing matrix ([8ce1958](https://github.com/CourtHive/competition-factory-server/commit/8ce195867b8e5487ce61c0dce1e0b98a8a562a36))

## [2.5.0](https://github.com/CourtHive/competition-factory-server/compare/v2.4.0...v2.5.0) (2026-05-24)


### Features

* **auth:** provisioner-managed providers + scope /admin to real admins ([a5235f4](https://github.com/CourtHive/competition-factory-server/commit/a5235f4609606c03483fcc35b3cce821199a70b7))
* **auth:** provisioner-managed providers + scope /admin to real admins ([af50563](https://github.com/CourtHive/competition-factory-server/commit/af50563ed7b9070243e9fdb09e4ef5e9be79fad8))
* **providers:** admin-issued, provider-scoped API keys ([65576e8](https://github.com/CourtHive/competition-factory-server/commit/65576e83a4825731777fc2aec1755ad4920f5176))
* **providers:** admin-issued, provider-scoped API keys ([8ac75cc](https://github.com/CourtHive/competition-factory-server/commit/8ac75cc9d22c01173310bc32bbb3510efc9fa81f))
* **swagger:** gate /api docs by CFS account role ([a14da5c](https://github.com/CourtHive/competition-factory-server/commit/a14da5cfa61cbf5a7481e9dbf3fc6629e7b2c8d9))
* **swagger:** gate /api docs by CFS account role, not a shared secret ([668bd14](https://github.com/CourtHive/competition-factory-server/commit/668bd1462e8bfaa551e46c5d931fc081512b8bc5))
* **swagger:** gate /api explorer + spec behind Basic auth in production ([da20516](https://github.com/CourtHive/competition-factory-server/commit/da20516d291d9c37d15eeb885f57403dcdcf3160))
* **swagger:** gate /api explorer + spec behind Basic auth in production ([0f05af0](https://github.com/CourtHive/competition-factory-server/commit/0f05af06d4d78965ff4f76249536b8daaa65219a))
* **swagger:** gate /api on shared-DB hosts (SWAGGER_REQUIRE_AUTH) ([be169cb](https://github.com/CourtHive/competition-factory-server/commit/be169cba5d083fe001ec3645a20c89fe0d80c1c0))
* **swagger:** gate /api on shared-DB hosts via SWAGGER_REQUIRE_AUTH ([75a5b9d](https://github.com/CourtHive/competition-factory-server/commit/75a5b9d51864a692a7022e263d0042ed8706a823))


### Bug Fixes

* **admin-client:** dark-mode contact-email banner + modal padding ([b8ff8be](https://github.com/CourtHive/competition-factory-server/commit/b8ff8be3c4db9095ef236d082151cd177ad1fab6))
* **auth:** align SSO session lifetime with direct login ([be115d1](https://github.com/CourtHive/competition-factory-server/commit/be115d11129484c54f2047d4f33835ff22a2e921))
* **auth:** align SSO session lifetime with direct login ([e690cd4](https://github.com/CourtHive/competition-factory-server/commit/e690cd43d99feaf63a736ac4089d7e9486c91296))
* **factory:** make checkUser multi-provider aware ([8708d1d](https://github.com/CourtHive/competition-factory-server/commit/8708d1d7388ac86ca7e7cf422d96a3cb0d7afb7d))
* provider-scoped tournament delete safeguards (authz, archive, end-date guard, calendar detach) ([c1343ea](https://github.com/CourtHive/competition-factory-server/commit/c1343ead096a54396ef9240db549740bff332ce2))
* **storage:** provider-scope + archive + end-date guard on tournament delete ([740541e](https://github.com/CourtHive/competition-factory-server/commit/740541ed8817e2a6c27bd95a748e78599618dc82))


### Documentation

* document provider/provisioner API keys + Swagger; sunset LevelDB ([5d39f37](https://github.com/CourtHive/competition-factory-server/commit/5d39f377a3f3f68aef8b1b91d6c23ba3ec1c968d))
* provider/provisioner API keys + Swagger; sunset LevelDB ([8a9c221](https://github.com/CourtHive/competition-factory-server/commit/8a9c221114e4cc071cfa76a7643685e48de3df8c))
* **swagger:** clarify Authorize button vs page login ([ec9b9ce](https://github.com/CourtHive/competition-factory-server/commit/ec9b9ce670cd6556b4b0ea9d7e0601abb5cc90f4))
* **swagger:** explain the Authorize button vs the page login ([e9c944f](https://github.com/CourtHive/competition-factory-server/commit/e9c944f0495643a7e26720b1fe51817964431fca))

## [2.4.0](https://github.com/CourtHive/competition-factory-server/compare/v2.3.0...v2.4.0) (2026-05-22)


### Features

* **account:** admin-create-user emails the new user (Phase B4) ([ba010f6](https://github.com/CourtHive/competition-factory-server/commit/ba010f612eb0409550f5156918fe0c4cff035079))
* **account:** contact-email + verification flow (Phase B2) ([15dc9a0](https://github.com/CourtHive/competition-factory-server/commit/15dc9a0cb608c9203a5a7342691296d8458af97e))
* **account:** contact-email + verification flow (Phase B2) ([bfbb6c5](https://github.com/CourtHive/competition-factory-server/commit/bfbb6c50ffd5718f5b629fb0fc1bf3cd044a361d))
* **account:** module boundary + EmailService skeleton (Phase B1) ([1fc5c88](https://github.com/CourtHive/competition-factory-server/commit/1fc5c88c3c0f6a5637ef1e7021904638d681bf65))
* **account:** module boundary + EmailService skeleton (Phase B1) ([bbb1dec](https://github.com/CourtHive/competition-factory-server/commit/bbb1dec9cbcd084a45275f267e075bed4077193e))
* **account:** password reset via link-token + confirmation email (Phase B3) ([b7c2229](https://github.com/CourtHive/competition-factory-server/commit/b7c222988771faa3c6222ba2877153da5fb20368))
* **account:** password reset via link-token + confirmation email (Phase B3) ([ce069ef](https://github.com/CourtHive/competition-factory-server/commit/ce069ef24c723909f90b4f65a772a04751430ef7))
* **audit:** wire AuditService into TmxGateway socket path ([a20d28b](https://github.com/CourtHive/competition-factory-server/commit/a20d28bd338ea56236ca466c5f5ca0e9cc272f9a))
* **audit:** wire AuditService into TmxGateway socket path ([a3422c9](https://github.com/CourtHive/competition-factory-server/commit/a3422c92195d62b0c686352621bea51945302efc))
* **auth:** admin-create-user direct flow with first-login password change ([02f76e4](https://github.com/CourtHive/competition-factory-server/commit/02f76e4e5941ab6bc8a2ab3545083cadf677dd0b))
* **auth:** admin-create-user direct flow with first-login password change ([f66ef0e](https://github.com/CourtHive/competition-factory-server/commit/f66ef0e285bce2a657b5c5eaaf6e4cce0d1db360))
* **providers:** archive + delete + revive (Plan A) ([108b044](https://github.com/CourtHive/competition-factory-server/commit/108b04429bc25c36ddb530532241bbddcec5cb56))
* **providers:** archive + delete + revive (Plan A) ([69878d3](https://github.com/CourtHive/competition-factory-server/commit/69878d3f8446affe2ba80c0a547522ca96cdecfb))


### Bug Fixes

* **admin-client:** bump notification font-size from 0.9rem to 1rem ([7d4cc89](https://github.com/CourtHive/competition-factory-server/commit/7d4cc898c63e6f44126682dc2c9101ece7c98603))
* **admin-client:** satisfies on BUILTIN_POLICIES so check-types passes ([b03a1ec](https://github.com/CourtHive/competition-factory-server/commit/b03a1ecf53876e4a993d08e14d721309582deb5e))
* **audit:** don't fall back to email when stamping userId in TmxGateway ([54ba0fa](https://github.com/CourtHive/competition-factory-server/commit/54ba0fa1da3d4dd0641f97b6a66c8889243185b7))

## [2.3.0](https://github.com/CourtHive/competition-factory-server/compare/v2.2.0...v2.3.0) (2026-05-21)


### Features

* **admin:** Users column shows all providers + remove from provider on detail pane ([4856148](https://github.com/CourtHive/competition-factory-server/commit/485614843cd864fe0e66f8761e0ba24340bd3b7b))
* **auth:** multi-provider session context (Phase 1 — CFS) ([2d30ee5](https://github.com/CourtHive/competition-factory-server/commit/2d30ee5c6811d73884c39f0b4978a96cafc3216d))
* **policies:** add delivery endpoints + service + validator ([b071403](https://github.com/CourtHive/competition-factory-server/commit/b071403d6c3a285d2022704dd64e8a9dadb41921))
* **policies:** add IPolicyStorage + Postgres impl + migration 024 ([cf79da8](https://github.com/CourtHive/competition-factory-server/commit/cf79da8b9933a893dcf5be29d136b41879d5f6b6))
* **policies:** add seed loader + generation script ([7227ee9](https://github.com/CourtHive/competition-factory-server/commit/7227ee9b9bb8782e6c3f00c802922fbae5f4d511))
* **policies:** hydrate factory engine registry from POLICY_STORAGE ([30ec6f6](https://github.com/CourtHive/competition-factory-server/commit/30ec6f669c5b0d8f77fa775318140326e4865310))
* **policies:** seed global ranking-points policies ([51dab16](https://github.com/CourtHive/competition-factory-server/commit/51dab16e4c66831593a353f3b39cadd9ca1f1f7e))


### Bug Fixes

* **admin-client:** guard policy fixtures removed in factory 4.0.0 ([827077b](https://github.com/CourtHive/competition-factory-server/commit/827077b5b1bc9c819a131f5d20bd6eb051f62642))
* **admin:** dark-mode-readable API key modal + stabilise pnpm v11 config ([40c2550](https://github.com/CourtHive/competition-factory-server/commit/40c2550be6846a95d47a6d0fe7cb54895a7d14c6))
* **admin:** surface multi-provider associations in providers panel ([b7241cc](https://github.com/CourtHive/competition-factory-server/commit/b7241ccf6182a8d699e4d95e30e16ad221da4303))
* **auth:** provisioner inherits provider access for impersonation ([02e23e3](https://github.com/CourtHive/competition-factory-server/commit/02e23e3e6e26b4991370208e627ce09fec8d60d4))
* **cache:** invalidate ged|... on PUBLISH_EVENT instead of seeding wrong shape ([c6701ad](https://github.com/CourtHive/competition-factory-server/commit/c6701ad12945f530b62d260559a6623cbea9c731))
* **deps:** update dependency tods-competition-factory to v4.0.0 ([5bf7c71](https://github.com/CourtHive/competition-factory-server/commit/5bf7c71f40e85972e9aeda7fc50dee558d07cdce))
* **factory:** wire userContext through fetch/save/generate ([df5ad02](https://github.com/CourtHive/competition-factory-server/commit/df5ad029eaad464bd7eb4dbf08621373b8a39678))
* **policies:** mark /policies/catalog @Public so anon callers reach it ([a9fffe8](https://github.com/CourtHive/competition-factory-server/commit/a9fffe85b219c99b9aa61a709f9d869376f84cab))
* **provisioner:** scope provider listing + tighten providers panel UI ([17c777b](https://github.com/CourtHive/competition-factory-server/commit/17c777bc07e7f71bb67fadf3819d6f10c2b09123))


### Documentation

* **policies:** seeds/policies/README.md ([0a84775](https://github.com/CourtHive/competition-factory-server/commit/0a847758caa25cd26f7c9cacc5f2664887d73711))

## [2.2.0](https://github.com/CourtHive/competition-factory-server/compare/v2.1.0...v2.2.0) (2026-05-18)


### Features

* **i18n:** make /i18n/manifest + /i18n/locales/:code public ([d02fdd0](https://github.com/CourtHive/competition-factory-server/commit/d02fdd0db7f7c2ec75d4373dfb3ebdbd5666be0c))


### Bug Fixes

* **admin-client:** white-on-light button contrast + clearable search inputs ([de69c4e](https://github.com/CourtHive/competition-factory-server/commit/de69c4e328d86dd2f0a9c431a451b9a729234803))
* **cors:** expose ETag header so TMX i18n cache populates ([13606b1](https://github.com/CourtHive/competition-factory-server/commit/13606b16d9e6a3eb790cf501de3d9eb22a05fb1a))


### Documentation

* **migrations:** annotate 020/021/022 with AFFECTS headers ([263561d](https://github.com/CourtHive/competition-factory-server/commit/263561d7ddf35cd5ffdde5cc0ff45f9103feaba5))

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
