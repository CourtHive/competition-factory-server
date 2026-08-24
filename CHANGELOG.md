# Changelog

## [2.28.0](https://github.com/CourtHive/competition-factory-server/compare/v2.27.0...v2.28.0) (2026-08-23)


### Features

* **auth:** expose the caller's own scoped grants ([#923](https://github.com/CourtHive/competition-factory-server/issues/923)) ([2c17ad9](https://github.com/CourtHive/competition-factory-server/commit/2c17ad9f98eefadb29cc4529d0bdb93323853731))
* **auth:** scoped, time-bounded capability grants ([#921](https://github.com/CourtHive/competition-factory-server/issues/921)) ([863ecee](https://github.com/CourtHive/competition-factory-server/commit/863eceee428713ee805911fc08aa7686f343ebeb))


### Bug Fixes

* **auth:** a grant's capability now bounds what it authorizes ([#922](https://github.com/CourtHive/competition-factory-server/issues/922)) ([962d790](https://github.com/CourtHive/competition-factory-server/commit/962d7906176d81840ab531927d590575191732f1))
* **auth:** close three mutation-authorization defects ([#919](https://github.com/CourtHive/competition-factory-server/issues/919)) ([bd6c3ea](https://github.com/CourtHive/competition-factory-server/commit/bd6c3eaaf334803a1bd019ea9d0214278f1f3582))
* **deps:** update @courthive/provider-config to 0.17.0 ([e0eb5c9](https://github.com/CourtHive/competition-factory-server/commit/e0eb5c91cec13dda98246a5b654234426812f446))

## [2.27.0](https://github.com/CourtHive/competition-factory-server/compare/v2.26.0...v2.27.0) (2026-08-23)


### Features

* **factory:** forward participantsVersion so the payload saving is reachable ([#914](https://github.com/CourtHive/competition-factory-server/issues/914)) ([79ceea2](https://github.com/CourtHive/competition-factory-server/commit/79ceea20ecc68641daf7e2b3185f0bbaca27a973))


### Bug Fixes

* **deps:** update audit-worker to tods-competition-factory 6.29.1 ([58c3d07](https://github.com/CourtHive/competition-factory-server/commit/58c3d0715ac4d5d868b79ef709897bddb8a9926c))
* **deps:** update tods-competition-factory to 6.29.0 ([6e198d6](https://github.com/CourtHive/competition-factory-server/commit/6e198d691c0f4a38a5b5f6ddc43d906175e229bb))
* **deps:** update tods-competition-factory to 6.29.1 ([9eeab61](https://github.com/CourtHive/competition-factory-server/commit/9eeab6191839fa0e314f3e4ab34e967cc83c38df))
* **deps:** update tods-competition-factory to 6.30.0 ([53e2383](https://github.com/CourtHive/competition-factory-server/commit/53e238399254d3103ee71449f5fdda7b152fceba))
* **notices:** preserve identity across keyed notice de-dup on the server path ([#911](https://github.com/CourtHive/competition-factory-server/issues/911)) ([c2713f8](https://github.com/CourtHive/competition-factory-server/commit/c2713f88749d86ae70a624f0843581d5797220b6))
* **public:** one privacy resolver for all five public routes ([#916](https://github.com/CourtHive/competition-factory-server/issues/916)) ([b55b7f3](https://github.com/CourtHive/competition-factory-server/commit/b55b7f3f0569acd814ec682e498e360f9355b6da))
* **public:** serve only competitors from the public participants route ([#917](https://github.com/CourtHive/competition-factory-server/issues/917)) ([8f381ce](https://github.com/CourtHive/competition-factory-server/commit/8f381ce37e91674e0c2a5a6c8fd02a623ae295c9))
* **public:** stop mutating the shared privacy fixture; gate draw routes honestly ([5cdf381](https://github.com/CourtHive/competition-factory-server/commit/5cdf381c661a55d86bdef2574f02b5b05192dbfd))

## [2.26.0](https://github.com/CourtHive/competition-factory-server/compare/v2.25.0...v2.26.0) (2026-08-18)


### Features

* **cache:** opt-in warmCache re-seeds evicted event payloads ([#895](https://github.com/CourtHive/competition-factory-server/issues/895)) ([c24c454](https://github.com/CourtHive/competition-factory-server/commit/c24c454e7338efca8f35d557e09d61269bdd0dca))
* **factory:** add draw and structure data endpoints with per-tier cache eviction ([#906](https://github.com/CourtHive/competition-factory-server/issues/906)) ([e0d485f](https://github.com/CourtHive/competition-factory-server/commit/e0d485fb1d9d7fca272aa2024731ec694e6f4b79))
* **factory:** project a snapshot and take the lock on wholesale record saves ([#901](https://github.com/CourtHive/competition-factory-server/issues/901)) ([404f0bb](https://github.com/CourtHive/competition-factory-server/commit/404f0bb0654a81422ab5012b7d2049107abeff3a))
* **registrations:** carry the registration-reserved participantId at accept ([#890](https://github.com/CourtHive/competition-factory-server/issues/890)) ([e7e3260](https://github.com/CourtHive/competition-factory-server/commit/e7e326017f0a1a67f0b7f831e490ddd81df8f77e))
* **registrations:** stamp a foreign sanctioning body's participant id at accept ([#891](https://github.com/CourtHive/competition-factory-server/issues/891)) ([133bd96](https://github.com/CourtHive/competition-factory-server/commit/133bd96d0575580e1d0555203ca6d9c764a11355))
* **registrations:** stamp foreign ids onto participants already in the record ([#892](https://github.com/CourtHive/competition-factory-server/issues/892)) ([93ca13b](https://github.com/CourtHive/competition-factory-server/commit/93ca13bb390bb9ede1f14da4aff1cbe773cce5b9))
* **storage:** add owner_epoch fencing and per-tournament load telemetry ([#900](https://github.com/CourtHive/competition-factory-server/issues/900)) ([b59d730](https://github.com/CourtHive/competition-factory-server/commit/b59d73042527c29054baa2533d7569415b4b4be8))


### Bug Fixes

* **cache:** warm the cache on the websocket path, not just http ([#897](https://github.com/CourtHive/competition-factory-server/issues/897)) ([408941d](https://github.com/CourtHive/competition-factory-server/commit/408941d6bd2fd2891b8c4e99863291fa24b4f728))
* **deps:** update @courthive/i18n to 0.4.7 ([3b330bd](https://github.com/CourtHive/competition-factory-server/commit/3b330bd0e6cc7a526b1cd721419d95480da80c2d))
* **deps:** update @courthive/i18n to 0.4.8 ([#910](https://github.com/CourtHive/competition-factory-server/issues/910)) ([dd8cb12](https://github.com/CourtHive/competition-factory-server/commit/dd8cb12042b1d6307bd90c26cba0679ff3d273ef))
* **deps:** update tods-competition-factory to 6.27.0 ([24e6a2b](https://github.com/CourtHive/competition-factory-server/commit/24e6a2b990d30eef2a16bc6033d52728aeabbe60))
* **deps:** update tods-competition-factory to 6.28.0 ([3d733dd](https://github.com/CourtHive/competition-factory-server/commit/3d733ddb6e0c4709dee0cc9958bdf7e65e752e5d))
* **deps:** update tods-competition-factory to 6.28.1 ([caf6710](https://github.com/CourtHive/competition-factory-server/commit/caf67108675553630c442bfe50241a88e2ee03d7))
* **factory:** stop losing read-model deltas on non-socket mutation paths ([b59d730](https://github.com/CourtHive/competition-factory-server/commit/b59d73042527c29054baa2533d7569415b4b4be8))
* **factory:** sweep cache tiers whose changes cannot be attributed ([#907](https://github.com/CourtHive/competition-factory-server/issues/907)) ([4ee6bf3](https://github.com/CourtHive/competition-factory-server/commit/4ee6bf32ab6b8ad4b7f96b62f1ce4baa1416bf1b))
* **projection:** scope every read-model delete and update by tournament_id ([#888](https://github.com/CourtHive/competition-factory-server/issues/888)) ([04b3ca2](https://github.com/CourtHive/competition-factory-server/commit/04b3ca2bb283a8be575f7e75eadc929e64e355fa))
* **tests:** serialise the suite — parallel workers share one Postgres ([#894](https://github.com/CourtHive/competition-factory-server/issues/894)) ([620f78e](https://github.com/CourtHive/competition-factory-server/commit/620f78e37755f59a248c7257bd950c834bace8ab))


### Performance

* **cache:** evict only the affected event's cached payload ([#893](https://github.com/CourtHive/competition-factory-server/issues/893)) ([3ef81a2](https://github.com/CourtHive/competition-factory-server/commit/3ef81a2cd7fc414cb79438486d5f5bea3d8a6ee2))


### Documentation

* **cache:** document the response cache, narrowing and warmCache ([#896](https://github.com/CourtHive/competition-factory-server/issues/896)) ([22e4044](https://github.com/CourtHive/competition-factory-server/commit/22e4044bfe64763c25ebb67d91b593665fd3c8d4))

## [2.25.0](https://github.com/CourtHive/competition-factory-server/compare/v2.24.2...v2.25.0) (2026-08-15)


### Features

* **factory:** name author peers in the shared-facility coordination projection ([#886](https://github.com/CourtHive/competition-factory-server/issues/886)) ([c1697be](https://github.com/CourtHive/competition-factory-server/commit/c1697bee8ed26b87e6144665271de093046b7fe2))


### Bug Fixes

* **deps:** update @courthive/provider-config to 0.13.0 ([6e4a379](https://github.com/CourtHive/competition-factory-server/commit/6e4a3792973fa388feabe083431c8104be682e19))
* **deps:** update tods-competition-factory to 6.22.1 ([98f8d5b](https://github.com/CourtHive/competition-factory-server/commit/98f8d5b0c993eb99747ea36e28d5afacb5a3e433))
* **deps:** update tods-competition-factory to 6.24.0 ([5577dc1](https://github.com/CourtHive/competition-factory-server/commit/5577dc11074934c70a6b4ee04b8cb29fb33da16c))
* **deps:** update tods-competition-factory to 6.25.0 ([fe4b801](https://github.com/CourtHive/competition-factory-server/commit/fe4b8012275ff573279fa1688a1d593d9567694d))
* **sanctioning:** describe the ams tier snapshot as a tierclassification ([#884](https://github.com/CourtHive/competition-factory-server/issues/884)) ([8e69153](https://github.com/CourtHive/competition-factory-server/commit/8e691537e7b9674394f7c6d2d17d1343b3d3c57f))
* **tests:** disable http throttling in jest so login limits stop flaking the suite ([#885](https://github.com/CourtHive/competition-factory-server/issues/885)) ([7b19d92](https://github.com/CourtHive/competition-factory-server/commit/7b19d92f95f2b81e7825c1b81a434cad682f834b))

## [2.24.2](https://github.com/CourtHive/competition-factory-server/compare/v2.24.1...v2.24.2) (2026-08-13)


### Bug Fixes

* **factory:** scope every HTTP request in a factory engine-state store ([d94e817](https://github.com/CourtHive/competition-factory-server/commit/d94e81782822cef22666ef4eb66ae15cdabc6f82))

## [2.24.1](https://github.com/CourtHive/competition-factory-server/compare/v2.24.0...v2.24.1) (2026-08-12)


### Bug Fixes

* **deps:** update tods-competition-factory to 6.22.0 ([ef7c732](https://github.com/CourtHive/competition-factory-server/commit/ef7c7325a5193801586f722ebaf464b15f96848e))
* **projection:** scope the full rebuild in one async-state context ([38475b0](https://github.com/CourtHive/competition-factory-server/commit/38475b0a41feae359831180015effd2e628be07b))

## [2.24.0](https://github.com/CourtHive/competition-factory-server/compare/v2.23.1...v2.24.0) (2026-08-12)


### Features

* **projection:** derive progression edges in the incremental producer ([11eeb57](https://github.com/CourtHive/competition-factory-server/commit/11eeb576cc4b59f5596954e648176caed5d2df49))


### Bug Fixes

* **deps:** update tods-competition-factory to 6.21.0 ([20f1b78](https://github.com/CourtHive/competition-factory-server/commit/20f1b78ea382ecfc51323133c5f4d0ec6f820746))

## [2.23.1](https://github.com/CourtHive/competition-factory-server/compare/v2.23.0...v2.23.1) (2026-08-09)


### Bug Fixes

* **deps:** update tods-competition-factory to 6.20.0 ([2260bc3](https://github.com/CourtHive/competition-factory-server/commit/2260bc36a0a1daff4cafffc0b1283a97bd6725d1))
* **projection:** re-project competitor names on a participant rename ([7b77599](https://github.com/CourtHive/competition-factory-server/commit/7b77599d89844b40a011be6edbb75f5daa28d975))
* **projection:** resolve events.published via factory's shared cascade predicate ([c3bb4e2](https://github.com/CourtHive/competition-factory-server/commit/c3bb4e285c9e7522a70d56cf87a27892e31cfe5c))

## [2.23.0](https://github.com/CourtHive/competition-factory-server/compare/v2.22.0...v2.23.0) (2026-08-07)


### Features

* **projection:** project a courts read-model table under venues ([559e808](https://github.com/CourtHive/competition-factory-server/commit/559e8083e4305b51912ee73c4b37cc65f3714678))
* **projection:** project a seeds read-model table from modify-seed-assignments ([c4ada22](https://github.com/CourtHive/competition-factory-server/commit/c4ada2226f134e7d1f35740c4633431337cb9b53))
* **projection:** project an events read-model table from the event topics ([ab7a7eb](https://github.com/CourtHive/competition-factory-server/commit/ab7a7ebf2e9dafaa71d99c8ed58fb6d875e2d0df))
* **projection:** project draws + structures read-model tables from draw definitions ([18cf877](https://github.com/CourtHive/competition-factory-server/commit/18cf877c77781914966f5131eae9a3b66f4d4a76))
* **projection:** project nested round-robin group structures ([61810f0](https://github.com/CourtHive/competition-factory-server/commit/61810f094e595f8ed2bcd5472a1f6e11a026aea1))
* **projection:** project nested round-robin group structures ([c87645b](https://github.com/CourtHive/competition-factory-server/commit/c87645b5064537c7c560718bf11c634886f664f4))
* **projection:** project order-of-play + scheduling-profile read-model tables ([8452640](https://github.com/CourtHive/competition-factory-server/commit/8452640d809fc959197eed6718d8da8e46ca7148))
* **projection:** project participant-publish + tournaments.published (the last publish topics) ([0f67257](https://github.com/CourtHive/competition-factory-server/commit/0f672575cb0c28bff0a83ea1eab5ad0ee565cd69))
* **projection:** subscribe deleted-matchup-ids to delete individual match_ups rows ([bb835db](https://github.com/CourtHive/competition-factory-server/commit/bb835dbea585a8606c379b86238c3e9f4a3629ba))
* **projection:** subscribe entries topics to refresh the entries read-model ([76fd73d](https://github.com/CourtHive/competition-factory-server/commit/76fd73d1091b6bc177a531b5a8cb3b5c97ea924e))
* **projection:** subscribe entries topics to refresh the entries read-model ([d0a1dab](https://github.com/CourtHive/competition-factory-server/commit/d0a1dab3d9f1c3f4439438e4d528e9b46e105d0d))
* **projection:** super-admin endpoint for read-model rebuild ([6e5ef46](https://github.com/CourtHive/competition-factory-server/commit/6e5ef469c47c60ebba07f6de217d59aad658090d))
* **provisioner:** flag-gated retirement of CFS write endpoints (moved to AMS) ([3faf5f6](https://github.com/CourtHive/competition-factory-server/commit/3faf5f6bda11ec2a686add5d1e122ef84ce19a7e))


### Bug Fixes

* **deps:** update tods-competition-factory to 6.14.0 ([7b0c715](https://github.com/CourtHive/competition-factory-server/commit/7b0c7155f7def9b6c751544d846ac8506a781352))
* **deps:** update tods-competition-factory to 6.14.1 ([6258ee2](https://github.com/CourtHive/competition-factory-server/commit/6258ee27d65a2edacdf7e0e8be5e50b15d194dd2))
* **deps:** update tods-competition-factory to 6.15.0 ([4c7d324](https://github.com/CourtHive/competition-factory-server/commit/4c7d324a67d29711fee29b13dec76a489057f059))
* **deps:** update tods-competition-factory to 6.16.0 ([529ca2f](https://github.com/CourtHive/competition-factory-server/commit/529ca2f25b7f0295a38f330174f73eac2192e73f))
* **deps:** update tods-competition-factory to 6.17.0 ([e0cc5a5](https://github.com/CourtHive/competition-factory-server/commit/e0cc5a581f991a32b5d2919a973752a5da863fd7))
* **deps:** update tods-competition-factory to 6.18.0 ([b0d7dca](https://github.com/CourtHive/competition-factory-server/commit/b0d7dca3ab216fa19a43fd8d63c361527f1ca36e))
* **deps:** update tods-competition-factory to 6.19.0 ([4f3b953](https://github.com/CourtHive/competition-factory-server/commit/4f3b953e6a6d9292be8402c7e4e45ed9abb56992))
* **factory:** give each entry point its own engine state context ([#866](https://github.com/CourtHive/competition-factory-server/issues/866)) ([c431916](https://github.com/CourtHive/competition-factory-server/commit/c431916661c3b84d129a0d186574d1b0d8326d57))
* **projection:** entries delete-by-parent (no stale query_entries row) + read-model story ([fca9567](https://github.com/CourtHive/competition-factory-server/commit/fca95679926eaa98d7fd8ec9846ad033aae42db8))
* **projection:** re-project entries with delete-by-parent so a removed entry leaves no stale row ([30fa2e8](https://github.com/CourtHive/competition-factory-server/commit/30fa2e8de7200bbb1de2cbf5bd021817d3c237d5))
* **projection:** re-project events on event-seeding publish so query_events.published is not stale ([b893d92](https://github.com/CourtHive/competition-factory-server/commit/b893d929778bdb716d376e12c1692d06fa0bdfaf))
* **projection:** rebuild reads scheduling profile with the shared legacy fallback ([21ce7c2](https://github.com/CourtHive/competition-factory-server/commit/21ce7c215f75bae1f55e197110e4bc0d80e60a12))
* **projection:** rebuild reads scheduling profile with the shared legacy fallback ([#6](https://github.com/CourtHive/competition-factory-server/issues/6)) ([5383dd3](https://github.com/CourtHive/competition-factory-server/commit/5383dd3c1b0b579347ee54f22bc1c5650fbd4e1f))
* **projection:** subscribe event-seeding publish topics (query_events.published no longer stale) ([9dd8ea3](https://github.com/CourtHive/competition-factory-server/commit/9dd8ea376699d33ba175c81701c1c4221e87578b))
* **projection:** thread matchUp roundNumber into read-model publish resolution ([9d0d6fe](https://github.com/CourtHive/competition-factory-server/commit/9d0d6fe1ff4413e19227a91ceb565cca647f9829))
* **projection:** thread roundNumber into publish resolution (paired with factory embargo/roundLimit fix) ([288f4ff](https://github.com/CourtHive/competition-factory-server/commit/288f4ffddb1e412779de51dfa8d4c930fb4f9812))
* **projection:** thread scheduleEmbargo into match_ups context ([#9](https://github.com/CourtHive/competition-factory-server/issues/9)) ([a9578a7](https://github.com/CourtHive/competition-factory-server/commit/a9578a7ae84526d8158fec369f48e35abc1448c2))
* **projection:** thread scheduleEmbargo into the match_ups projection context ([dc514b3](https://github.com/CourtHive/competition-factory-server/commit/dc514b32a2631879571c47c14a44442c8a343956))


### Documentation

* **architecture:** describe the real per-request isolation mechanism ([#868](https://github.com/CourtHive/competition-factory-server/issues/868)) ([629592d](https://github.com/CourtHive/competition-factory-server/commit/629592d6d75916b74f45b40487ef0d85ec584f45))
* **projection:** add read-model projection storybook architecture story ([9b1a538](https://github.com/CourtHive/competition-factory-server/commit/9b1a5383d70a57e9c135336204c8865701766766))

## [2.22.0](https://github.com/CourtHive/competition-factory-server/compare/v2.21.0...v2.22.0) (2026-07-29)


### Features

* **throttle:** add env flag to disable http rate limiting for local/ci e2e ([#844](https://github.com/CourtHive/competition-factory-server/issues/844)) ([38cfa0b](https://github.com/CourtHive/competition-factory-server/commit/38cfa0b98a867aabc616b7ce4df77e485d013da0))


### Bug Fixes

* **deps:** update tods-competition-factory to 6.13.1 ([f59a90b](https://github.com/CourtHive/competition-factory-server/commit/f59a90bfa61f464b26af21e811beff67843891b5))
* **deps:** update tods-competition-factory to 6.13.2 ([aa09c63](https://github.com/CourtHive/competition-factory-server/commit/aa09c635e66b524826d99865a3558890e2f28004))
* **deps:** update tods-competition-factory to 6.13.2 ([bbc241f](https://github.com/CourtHive/competition-factory-server/commit/bbc241f110736a2f70ac721f2148704f3d5a0e9c))

## [2.21.0](https://github.com/CourtHive/competition-factory-server/compare/v2.20.0...v2.21.0) (2026-07-27)


### Features

* **projection:** person-claim → person_id producer handler + update delta op ([9637e2d](https://github.com/CourtHive/competition-factory-server/commit/9637e2d6b92f0ff34cb98fab4d24754fe1f12e1f))
* **projection:** read-model projection outbox producers (increment 2) ([35e1f34](https://github.com/CourtHive/competition-factory-server/commit/35e1f3485eea62e79c403be6d2bb853fc29f273f))
* **projection:** rebuild/backfill pipeline + byte-identical conformance test (increment 5) ([1c97292](https://github.com/CourtHive/competition-factory-server/commit/1c972929eae35379e329a66da78389f2c80e16b5))
* sign SPLIT tournament tokens via the hiveid IdP mint ([#834](https://github.com/CourtHive/competition-factory-server/issues/834)) ([08dc136](https://github.com/CourtHive/competition-factory-server/commit/08dc136381988e3955a7dec00e02a48677b8925a))


### Bug Fixes

* **app:** drop FederationDataModule import/registration (retire follow-up) ([e10dec8](https://github.com/CourtHive/competition-factory-server/commit/e10dec8e9f601c1887bfd679b3b77724fc1c0d88))
* **deps:** patch fast-uri to 3.1.4 (host confusion advisory) ([fd9b915](https://github.com/CourtHive/competition-factory-server/commit/fd9b9151820b46aff2815fddee975355404f6075))
* **deps:** update tods-competition-factory to 6.12.0 ([f4dde2c](https://github.com/CourtHive/competition-factory-server/commit/f4dde2c7aab6250041f4c6718914fe624e1e6280))
* **deps:** update tods-competition-factory to 6.13.0 ([f499dd7](https://github.com/CourtHive/competition-factory-server/commit/f499dd7ff668cff799295e0dca352871cf0bc8b8))
* **messaging:** never trust client-supplied user id in tmx audit attribution ([7e56106](https://github.com/CourtHive/competition-factory-server/commit/7e5610628bb2e15619a1fa32fda32596dd76cd8c))
* **projection:** don't double-project team-tie rubbers + ITA team validation ([f9cd7f5](https://github.com/CourtHive/competition-factory-server/commit/f9cd7f5bb2b504bcabed321b3360fc1f397cfca2))

## [2.20.0](https://github.com/CourtHive/competition-factory-server/compare/v2.19.0...v2.20.0) (2026-07-22)


### Features

* **auth:** collect birth date + sex + provider on hiveid signup to mint or dedupe a person ([77fa09f](https://github.com/CourtHive/competition-factory-server/commit/77fa09f6f870b822cc2931c8c855563eef46e966))
* **auth:** mint scoped score token for hiveid crowd scorers ([bdde5a7](https://github.com/CourtHive/competition-factory-server/commit/bdde5a787535638f09c753fd450e03ec4d4942b0))
* **broadcast:** opaque facilityScheduleChanged fan-out to linked facility peers ([5b35987](https://github.com/CourtHive/competition-factory-server/commit/5b359870a1a57b82e262dcb6d42170d0b4d1612e))
* **broadcast:** opaque facilityScheduleChanged fan-out to linked facility peers ([e8c5687](https://github.com/CourtHive/competition-factory-server/commit/e8c5687c24b0069033a0e862d72d8fa33ab4c8f4))
* **declarations:** availability pull endpoint + declarations client ([d67edc3](https://github.com/CourtHive/competition-factory-server/commit/d67edc398364a0f15cbf91a4dc2c5553803efdb1))
* **declarations:** client getRegistration(declarationId) for the accept read ([ca96a51](https://github.com/CourtHive/competition-factory-server/commit/ca96a51af855f55934e1225f176e0f0f165ac35d))
* **declarations:** client methods to list + transition registrations ([ada108a](https://github.com/CourtHive/competition-factory-server/commit/ada108a6a9a09d07ef9fc20e76bb946104f5c852))
* dual-accept es256 token verification + jwks endpoint ([a83d29f](https://github.com/CourtHive/competition-factory-server/commit/a83d29f9b37da104a53a34d04acdb1f49b48ec28))
* **factory:** coordination-view schedule projection with access flag ([2930b25](https://github.com/CourtHive/competition-factory-server/commit/2930b25acf0aa492b317e7dfbd5df52f92ab7d00))
* **factory:** coordination-view schedule projection with access flag ([d296668](https://github.com/CourtHive/competition-factory-server/commit/d296668b884ca899a755d978381459871b5247d6))
* flag-gated es256 signer + hs256-drop toggle (jwt migration steps 3-4) ([b16cf62](https://github.com/CourtHive/competition-factory-server/commit/b16cf627fd5fd5d61f7fade00e19b1e99fcdc814))
* **hiveid:** let a public user edit an unverified contact email ([10d4fb4](https://github.com/CourtHive/competition-factory-server/commit/10d4fb48e35a15169da39fa963c4259506694143))
* **registrations:** accept reads from declarations, off-CFS status ([fbb4563](https://github.com/CourtHive/competition-factory-server/commit/fbb4563868bdd433bb506e90f564200c04ec8361))
* **registrations:** bulk accept in one executionQueue + accept-pair path ([ba56eeb](https://github.com/CourtHive/competition-factory-server/commit/ba56eebd6c54bc667741abd1645bcdaf1f9d647e))
* **registrations:** lazy-activate tournamentRecord from sanctioning on first accept ([2c9d390](https://github.com/CourtHive/competition-factory-server/commit/2c9d39053c85ade585d038b877ec83dbf67d7252))
* **registrations:** resolve accepted events by stable id, warn on unresolved drop ([473b342](https://github.com/CourtHive/competition-factory-server/commit/473b3422b84545bca8f78d25a89b4ac398ca2984))


### Bug Fixes

* **declarations:** default declarations base url to port 3120 ([6ad6238](https://github.com/CourtHive/competition-factory-server/commit/6ad62381da857f83c74c85cec3b696c5b85ec454))
* **deps:** override brace-expansion to patched versions to clear audit ([79a4814](https://github.com/CourtHive/competition-factory-server/commit/79a481449f68916f0bf00dcd9a3c0cb479a63efe))
* **deps:** update tods-competition-factory to 6.10.0 ([e9bd6ee](https://github.com/CourtHive/competition-factory-server/commit/e9bd6eed1a955da94e558fb3b626d6f7a054a22e))
* **deps:** update tods-competition-factory to 6.11.0 ([52898aa](https://github.com/CourtHive/competition-factory-server/commit/52898aafc0800458e869de180a43621c35361573))
* **hiveid:** give the dev test super-admin a userId so its /me surface works ([7218af9](https://github.com/CourtHive/competition-factory-server/commit/7218af966301403a0937b7d4ccaa4b31c1f67514))
* **registrations:** set participantRole competitor on accepted participants ([44cd840](https://github.com/CourtHive/competition-factory-server/commit/44cd8407eef6e1126a3e3923775225ffb8e2ce63))

## [2.19.0](https://github.com/CourtHive/competition-factory-server/compare/v2.18.0...v2.19.0) (2026-07-14)


### Features

* **security:** add cors allowlist, rate limiting, and nosniff header ([965f60c](https://github.com/CourtHive/competition-factory-server/commit/965f60cecfe3f715459ff5f26840132b7d79e001))
* **security:** tighten rate limits on public auth endpoints ([f9ed3c7](https://github.com/CourtHive/competition-factory-server/commit/f9ed3c7255727e6d59aeea03cd265690f1f1bdf4))

## [2.18.0](https://github.com/CourtHive/competition-factory-server/compare/v2.17.1...v2.18.0) (2026-07-14)


### Features

* add run-unprocessed and rerun-from-date rankings republish endpoints ([043616a](https://github.com/CourtHive/competition-factory-server/commit/043616a34ae6ac94948e7cefc77ec500dc7c76e8))
* **factory:** authenticated schedule-projection endpoint for shared-facility view ([d0c07ec](https://github.com/CourtHive/competition-factory-server/commit/d0c07ec991621d16f9e3696deb117279ea3a4606))
* **factory:** authenticated schedule-projection endpoint for shared-facility view ([#818](https://github.com/CourtHive/competition-factory-server/issues/818)) ([1b1a6a2](https://github.com/CourtHive/competition-factory-server/commit/1b1a6a2c68de66af67d1cae1309b4d827f212315))


### Bug Fixes

* audit and identity-stamp score submissions on the score path ([a2badf2](https://github.com/CourtHive/competition-factory-server/commit/a2badf2f0398ace2bcc8e54deba7067c751edb20))
* **deps:** pin typescript to 6.0.3 to block native ts7 (unbreaks nest cli + eslint sonarjs) ([b4d1d28](https://github.com/CourtHive/competition-factory-server/commit/b4d1d28155c83a1f2ba8da8f14a2df46a781b705))
* **deps:** revert typescript to 6.0.3 (TS7 breaks nest CLI) ([#821](https://github.com/CourtHive/competition-factory-server/issues/821)) ([2f5f9c4](https://github.com/CourtHive/competition-factory-server/commit/2f5f9c4ba42b133ae0a1f3616fec674fbb6da61b))
* **deps:** update tods-competition-factory to 6.4.0 ([19ba04c](https://github.com/CourtHive/competition-factory-server/commit/19ba04cc5d64a7b7da312f06f44f9be9a27845d3))
* **deps:** update tods-competition-factory to 6.5.0 ([1e85a4b](https://github.com/CourtHive/competition-factory-server/commit/1e85a4be6ca7d6fd0ed81c4ea2aceb01a53aec85))
* **deps:** update tods-competition-factory to 6.6.0 ([7570327](https://github.com/CourtHive/competition-factory-server/commit/7570327102fbaf0f1c0e111b07fdd2a80ead42f5))
* **deps:** update tods-competition-factory to 6.7.0 ([4014c25](https://github.com/CourtHive/competition-factory-server/commit/4014c25e515b5059ebed7e6977492ba83f3303cc))
* stamp owning provider onto records during rankings recompute ([c6e1a89](https://github.com/CourtHive/competition-factory-server/commit/c6e1a8968e262812a21eae356e57ce0c46eae758))
* stamp provider on single-tournament rankings republish too ([36a79e2](https://github.com/CourtHive/competition-factory-server/commit/36a79e2f5eea18c60b10cdd934c182f098590d69))

## [2.17.1](https://github.com/CourtHive/competition-factory-server/compare/v2.17.0...v2.17.1) (2026-07-06)


### Bug Fixes

* **deps:** keep audit-worker on tods-competition-factory 5.9.0 (defer 6.x migration) ([5cf25e9](https://github.com/CourtHive/competition-factory-server/commit/5cf25e99720a7b7f2bbcc6bbe7c5f239746ac860))
* **deps:** migrate audit-worker to tods-competition-factory 6.1.1 ([1625d86](https://github.com/CourtHive/competition-factory-server/commit/1625d86abe4d20c0a4a09faaddacc5df89236c58))
* **deps:** update tods-competition-factory to 6.2.0 ([4dbcbf4](https://github.com/CourtHive/competition-factory-server/commit/4dbcbf48519e7db7438425e91d9bdee9de9b1143))
* **deps:** update tods-competition-factory to 6.3.0 ([698850d](https://github.com/CourtHive/competition-factory-server/commit/698850d91ef3cbb3b51d93e67893ca1984fc8875))

## [2.17.0](https://github.com/CourtHive/competition-factory-server/compare/v2.16.0...v2.17.0) (2026-07-04)


### Features

* **factory:** attach participant-privacy policy on create + apply-to-existing ([#801](https://github.com/CourtHive/competition-factory-server/issues/801)) ([d0969d3](https://github.com/CourtHive/competition-factory-server/commit/d0969d3517adc034f9fff164b1b4b44927c361a1))
* **rankings:** provider-scoped recompute (republish + snapshots) ([#803](https://github.com/CourtHive/competition-factory-server/issues/803)) ([3903fb1](https://github.com/CourtHive/competition-factory-server/commit/3903fb15f65b9332645c0a09f62dab5fbf151f51))


### Bug Fixes

* **auth:** allow super-admins to persist last-selected provider ([6d1e9a4](https://github.com/CourtHive/competition-factory-server/commit/6d1e9a4d78fc13aaa5eca0bf1e49202bdaf35e76))


### Documentation

* refresh storage/admin/architecture docs and add module docs ([11ce2fd](https://github.com/CourtHive/competition-factory-server/commit/11ce2fd12bb6b4d2c26eb70457cc495db8131605))

## [2.16.0](https://github.com/CourtHive/competition-factory-server/compare/v2.15.0...v2.16.0) (2026-07-03)


### Features

* **participants:** honor attached participant-privacy policy in getParticipants ([#799](https://github.com/CourtHive/competition-factory-server/issues/799)) ([04d3c25](https://github.com/CourtHive/competition-factory-server/commit/04d3c2545b21f9ef6d8b8be75f2bc88e9a7e6806))

## [2.15.0](https://github.com/CourtHive/competition-factory-server/compare/v2.14.0...v2.15.0) (2026-06-30)


### Features

* **account:** hiveid email verification and email_verified claim ([4fefe75](https://github.com/CourtHive/competition-factory-server/commit/4fefe75032a98f24a04b34d47213350efca842bb))
* **auth:** provider-scoring-token mint for relay clients ([a83f5b0](https://github.com/CourtHive/competition-factory-server/commit/a83f5b0ac3c27cadf884902d6f461c1b899891ca))
* **providers:** public scoring-launch endpoint by tournament ([33ab316](https://github.com/CourtHive/competition-factory-server/commit/33ab316a8cc5f780b7a8c7ce4e896ae7c77bec17))
* **scripts:** add idempotent intennse provider provisioning script ([fc79c95](https://github.com/CourtHive/competition-factory-server/commit/fc79c951d6d69d304f7c06fd5081e33f7d5d779c))


### Bug Fixes

* **cors:** allow PUT/PATCH/DELETE cross-origin ([51f877a](https://github.com/CourtHive/competition-factory-server/commit/51f877a6cbb4014b1f3213ce500b18f62c215eb9))
* **deps:** bump audit-worker tods-competition-factory to 5.9.0 ([8c88c6a](https://github.com/CourtHive/competition-factory-server/commit/8c88c6a64d12f6879db7458f4c1fe93c091325f7))

## [2.14.0](https://github.com/CourtHive/competition-factory-server/compare/v2.13.1...v2.14.0) (2026-06-27)


### Features

* **chat:** page admin chat monitor through full retention window ([#783](https://github.com/CourtHive/competition-factory-server/issues/783)) ([96cab4b](https://github.com/CourtHive/competition-factory-server/commit/96cab4b6cfc168c457c49fd0b127faf064e0c786))

## [2.13.1](https://github.com/CourtHive/competition-factory-server/compare/v2.13.0...v2.13.1) (2026-06-24)


### Bug Fixes

* **audit:** serialize error code, stamp rest-path identity, log info field ([4a58d09](https://github.com/CourtHive/competition-factory-server/commit/4a58d096d895cf55b14ae61aae868776319d3e24))
* **deps:** update courthive-components to 3.4.4 in admin-client ([fdf6776](https://github.com/CourtHive/competition-factory-server/commit/fdf6776c92453a4f94ee05556fc6b446c5bf72ef))
* **deps:** update tods-competition-factory to 5.7.1 ([8cf1895](https://github.com/CourtHive/competition-factory-server/commit/8cf1895421f49e340fb927de18aeb498cab3eedf))

## [2.11.0](https://github.com/CourtHive/competition-factory-server/compare/v2.10.0...v2.11.0) (2026-06-07)


### Features

* **policies:** seed TYPTI ranking-points policy ([6c89f1d](https://github.com/CourtHive/competition-factory-server/commit/6c89f1d0f59e0229682963e134ce05d614dcb6d1))
* **rankings-proxy:** expose courthive-rankings via /api/rankings/* ([217036f](https://github.com/CourtHive/competition-factory-server/commit/217036ffb8413e68aaa3f6c4565d341e601f2839))


### Bug Fixes

* **rankings-proxy:** mark catch-all @Public to bypass global AuthGuard ([7d7eaea](https://github.com/CourtHive/competition-factory-server/commit/7d7eaeac914b15ee9a899d50215bf654b24f72e0))

## [2.10.0](https://github.com/CourtHive/competition-factory-server/compare/v2.9.0...v2.10.0) (2026-06-03)


### Features

* **audit:** record PASSWORD_RESET for every password-mutation path ([b9207a9](https://github.com/CourtHive/competition-factory-server/commit/b9207a9260c65c5c80c9d381d912873f0fb747d6))


### Bug Fixes

* **sso:** bound redis initial connect so boot survives redis-down ([454638b](https://github.com/CourtHive/competition-factory-server/commit/454638bc6b80ca2ca22ed63c48a93b05e382bd7e))

## [2.9.0](https://github.com/CourtHive/competition-factory-server/compare/v2.8.0...v2.9.0) (2026-06-02)


### Features

* **account:** project standard_given_name into firstName on user reads ([d9fe115](https://github.com/CourtHive/competition-factory-server/commit/d9fe1152c4fd38fd1d05c854df0898ddcfb5220e))
* **admin-client:** first/last name fields in create + edit user modals — wip ([cf2819e](https://github.com/CourtHive/competition-factory-server/commit/cf2819e8b2ef10d386775a4ad2bdd4fb443afd79))
* **auth:** log audience-mismatch + refresh-health endpoint ([0060b4d](https://github.com/CourtHive/competition-factory-server/commit/0060b4d280e9f7ca609873b57882aeb0b9fcaca6))


### Bug Fixes

* **build:** stop pnpm at CFS root from deleting audit-worker lockfile ([547826f](https://github.com/CourtHive/competition-factory-server/commit/547826f3ec2c95a11395405dc50df01ba02fd135))


### Reverts

* **admin-client:** drop incomplete firstname/lastname wip from 0060b4d ([3c18113](https://github.com/CourtHive/competition-factory-server/commit/3c18113cfcf059129233461190aac74fdc6870fa))


### Documentation

* **readme:** drop pluggable-storage / LevelDB language ([dec52df](https://github.com/CourtHive/competition-factory-server/commit/dec52df1bc872a9d0ee2e6b30178176f299eb80f))
* **seeds:** drop pinned factory@3.x version from example metadata ([d1c8f16](https://github.com/CourtHive/competition-factory-server/commit/d1c8f1634c691bf7f6666074f945b139c5327370))

## [2.8.0](https://github.com/CourtHive/competition-factory-server/compare/v2.7.0...v2.8.0) (2026-06-01)


### Features

* **account:** add /auth/hiveid/* endpoints + audience-aware AuthGuard (PR-G) ([15c64f3](https://github.com/CourtHive/competition-factory-server/commit/15c64f320358b86eaa8130c06430c9583881de4c))
* **account:** add PersonsClient — HTTP + SSE consumer for courthive-persons (HiveID PR-F) ([0b61bcc](https://github.com/CourtHive/competition-factory-server/commit/0b61bccf0af578dfa7ecda65b649029ce8d5a275))
* **account:** audit events for contact-email change + verify ([369435f](https://github.com/CourtHive/competition-factory-server/commit/369435f5636fc52a45ee38de3402975c73522cc2))
* **account:** backfill nudge tile for recovery email coverage ([d2b4c54](https://github.com/CourtHive/competition-factory-server/commit/d2b4c54be619ac124a6bd8fffe059140b0060889))
* **account:** editable contactEmail in admin modifyUser path ([37746e8](https://github.com/CourtHive/competition-factory-server/commit/37746e8d70d21aab61ee2c067b6f0e9f7213b4dc))
* **account:** provider-admin scoping on modifyUser ([b530897](https://github.com/CourtHive/competition-factory-server/commit/b530897c368a4864f8f8cf276303bcee7d3cadcc))
* **admin-client:** /system Audit tab for restoring deleted draws ([1368d6c](https://github.com/CourtHive/competition-factory-server/commit/1368d6ca49e569e4edd4ffd1513a3094901a3278))
* **admin-client:** /system Audit tab for restoring deleted draws ([0db89c4](https://github.com/CourtHive/competition-factory-server/commit/0db89c44436fa345dd217840f643374bc479c472))
* **admin-client:** recovery email field in Edit User modal ([41e7ca4](https://github.com/CourtHive/competition-factory-server/commit/41e7ca4029ba664d429105e7605232367580aa3d))
* **admin-client:** themeTokens + stylesheetUrl in provider caps editor ([150af17](https://github.com/CourtHive/competition-factory-server/commit/150af17dfbc51327e0a76be65e5792479e6cb325))
* **audit:** add POST /audit/restore-draw + IAuditStorage.findById ([cadb25f](https://github.com/CourtHive/competition-factory-server/commit/cadb25f26c6ddbdbe2bdb2cf2059be52b1511739))
* **audit:** failure-counter persistence, actor query, hardened tests ([ee09a27](https://github.com/CourtHive/competition-factory-server/commit/ee09a27f1b5b8beb2db0713623a1fd653ec35ef9))
* **audit:** polymorphic actor + milestone-throttled failure logs ([9b656a3](https://github.com/CourtHive/competition-factory-server/commit/9b656a3d93cdcd7be23d8ab6a308667ff273c784))
* **auth:** /auth/tracker-token mints score-aud JWTs for score-relay ([fc1dc53](https://github.com/CourtHive/competition-factory-server/commit/fc1dc5302de74af67955791d900a9f2d9b54fd2f))
* capture draw-deletion audit trail via factory AUDIT topic (CODES Phase 6) ([7e09fd1](https://github.com/CourtHive/competition-factory-server/commit/7e09fd10b9afa4c4d42b115a85d4769abdffe3f0))
* capture draw-deletion audit trail via factory AUDIT topic (CODES Phase 6) ([fd51329](https://github.com/CourtHive/competition-factory-server/commit/fd513297d7e595fe107c8d0b9b9798f57d81647d))
* **config:** config-readiness service and admin endpoint ([2d3697c](https://github.com/CourtHive/competition-factory-server/commit/2d3697c1aa0dc27c25422494886283500fd62a1d))
* **factory:** invalidate per-tournament cache after writes ([835db6e](https://github.com/CourtHive/competition-factory-server/commit/835db6e69fa9f791c6d589c175e4dd84192e8e96))
* **factory:** synchronous L2 validation gate on /factory/save ([7e63321](https://github.com/CourtHive/competition-factory-server/commit/7e633212db7cccc63d8578aed6b2b01430d412bd))
* **hiveid:** participations + claimable + claim endpoints (PR-J.5) ([b719abb](https://github.com/CourtHive/competition-factory-server/commit/b719abbb59214ba708ee18e3cc610b0d4a440c8c))
* **messaging:** add /hiveid socket namespace + audience-aware SocketGuard (PR-H) ([6a7813b](https://github.com/CourtHive/competition-factory-server/commit/6a7813b79c75b5929b02c222a5f3f10b56afc8ed))
* **persons:** fan personMerged events out to /hiveid rooms (Phase 4.0 MVP) ([8d591f5](https://github.com/CourtHive/competition-factory-server/commit/8d591f5402d1056d72217424ef5b8b93996d6e26))
* **providers:** public branding-by-tournament endpoint + ITA seed script ([6be6b0c](https://github.com/CourtHive/competition-factory-server/commit/6be6b0ce6906372df1e0948e410614a300466159))
* **registrations:** /me/registrations applicant surface (hiveid phase 2-A) ([4614eb0](https://github.com/CourtHive/competition-factory-server/commit/4614eb0fa217db09e59f9092e2044576abeae566))
* **registrations:** director-side acceptance flow (hiveid phase 2-B) ([24afb77](https://github.com/CourtHive/competition-factory-server/commit/24afb77c46d4ccf55140089edee513ccb0a0b609))
* **registrations:** enrich admin list with applicant cached name + email ([bc9105e](https://github.com/CourtHive/competition-factory-server/commit/bc9105ecb4380c1d5887f85551efee3e3ba5dd36))
* **score:** resolve drawId server-side in setMatchUpStatus wrapper ([e0f9320](https://github.com/CourtHive/competition-factory-server/commit/e0f9320cfe2fa8764241aa176561aa651a46a9cd))
* **users:** add hiveid linkage columns + storage methods (PR-E) ([61c8033](https://github.com/CourtHive/competition-factory-server/commit/61c80335f1d1685200c9ee2ad67beb9736138750))


### Bug Fixes

* **admin-client:** dark-mode capable sanctioning + systemTab ([85b85c7](https://github.com/CourtHive/competition-factory-server/commit/85b85c78b3ae5c20c0f752242cdedfe60ce72cc8))
* **admin-client:** replace native window.prompt/confirm with themed cModal ([55f9f62](https://github.com/CourtHive/competition-factory-server/commit/55f9f6280ea87645f4c02466b571ed14e3bf6f4f))
* **auth:** override JwtModule's global expiresIn at the tracker-token call site ([97dca4c](https://github.com/CourtHive/competition-factory-server/commit/97dca4c37a66dfe7cb40eb9abcdebe94f6fcbbe5))
* **auth:** tracker-token attributes mints to provisioner + rejects null ttl ([68d9d1b](https://github.com/CourtHive/competition-factory-server/commit/68d9d1b3ee96d4f67973b7b53d1cd3d225d0ed12))
* close 4 HIGH items from the design-flaws punch list ([dcb7ceb](https://github.com/CourtHive/competition-factory-server/commit/dcb7ceb70533376e0354c62ff3d4ff0207ea17e3))
* **config-readiness:** emit summary at WARN (yellow) instead of ERROR (red) ([c1ce8e4](https://github.com/CourtHive/competition-factory-server/commit/c1ce8e4ed3a60eefec07e8cf666360edbc03969e))
* **config-readiness:** letter-boundary placeholder regex + env restored via replaceProperty ([a25c349](https://github.com/CourtHive/competition-factory-server/commit/a25c34970452803711450a4bdef273d2a7ab1301))
* **factory:** per-tournament cache invalidation, side-table cap, WS prefix extension ([3d6e717](https://github.com/CourtHive/competition-factory-server/commit/3d6e7175d580edb80a67532ef17ae63151dbdc27))
* **factory:** stamp provisioner ownership + await save in /factory/generate ([1ad525c](https://github.com/CourtHive/competition-factory-server/commit/1ad525c4b47c137c80be5d8bf29f90c9f1464f5a))
* **persons-client:** surface SSE connect + recovery at warn level ([41aecd2](https://github.com/CourtHive/competition-factory-server/commit/41aecd206ce3e0861c8f6581f83a86b875ad2686))
* **persons:** exponential backoff + log throttling + PERSONS_DISABLED opt-out ([d0ad805](https://github.com/CourtHive/competition-factory-server/commit/d0ad805e0cb504396983d37f274ccbde8b093a64))
* **provisioner:** jwt path synthesizes req.user and preserves super_admin ([57d9f5f](https://github.com/CourtHive/competition-factory-server/commit/57d9f5fef6f680a3b94d980eb21d857551afe34e))
* **socket-guard:** accept handshake.auth.token before authorization header ([9f7cdd7](https://github.com/CourtHive/competition-factory-server/commit/9f7cdd73fee019344b5da49774e1c99de77fd199))
* **types:** null-safety on tournamentEngine.allTournamentMatchUps spec ([7ce5dfa](https://github.com/CourtHive/competition-factory-server/commit/7ce5dfaf47e92f6915fb1c08c4ab582ee28940e1))


### Documentation

* add Provider Theming page ([5e3a934](https://github.com/CourtHive/competition-factory-server/commit/5e3a934eac54117fba034a9d8cf46691367cc969))
* **env:** surface PERSONS_DISABLED opt-out in .env.example ([176e539](https://github.com/CourtHive/competition-factory-server/commit/176e539b0ea38076b7fa2f563da68530666c956d))
* **factory:** strengthen comments + COALESCE-preserve last_failure_message ([a76075c](https://github.com/CourtHive/competition-factory-server/commit/a76075cab10561245cddd5f87417a1401843a5fd))

## [2.7.0](https://github.com/CourtHive/competition-factory-server/compare/v2.6.0...v2.7.0) (2026-05-25)


### Features

* **auth:** passwordless magic-link login ([142ca51](https://github.com/CourtHive/competition-factory-server/commit/142ca51bebae2dbceeae1766a1eb34158e88b3ab))

## [2.6.0](https://github.com/CourtHive/competition-factory-server/compare/v2.5.2...v2.6.0) (2026-05-25)


### Features

* **auth:** rotating refresh tokens for long-lived sessions ([4180e61](https://github.com/CourtHive/competition-factory-server/commit/4180e61b2cb07739e3c94f25690229e5666d0d6b))
* **fonts:** host PDF font catalog + binaries for Latin-2 support ([#702](https://github.com/CourtHive/competition-factory-server/issues/702)) ([939af8a](https://github.com/CourtHive/competition-factory-server/commit/939af8adf399e53453b28d334d7767080a423948))

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
