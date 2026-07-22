# Changelog

## [1.1.5](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.1.4...audit-worker-v1.1.5) (2026-07-22)


### Bug Fixes

* **deps:** update tods-competition-factory to 6.10.0 ([e9bd6ee](https://github.com/CourtHive/competition-factory-server/commit/e9bd6eed1a955da94e558fb3b626d6f7a054a22e))
* **deps:** update tods-competition-factory to 6.11.0 ([52898aa](https://github.com/CourtHive/competition-factory-server/commit/52898aafc0800458e869de180a43621c35361573))

## [1.1.4](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.1.3...audit-worker-v1.1.4) (2026-07-14)


### Bug Fixes

* **deps:** revert typescript to 6.0.3 (TS7 breaks nest CLI) ([#821](https://github.com/CourtHive/competition-factory-server/issues/821)) ([2f5f9c4](https://github.com/CourtHive/competition-factory-server/commit/2f5f9c4ba42b133ae0a1f3616fec674fbb6da61b))
* **deps:** update tods-competition-factory to 6.4.0 ([19ba04c](https://github.com/CourtHive/competition-factory-server/commit/19ba04cc5d64a7b7da312f06f44f9be9a27845d3))
* **deps:** update tods-competition-factory to 6.5.0 ([1e85a4b](https://github.com/CourtHive/competition-factory-server/commit/1e85a4be6ca7d6fd0ed81c4ea2aceb01a53aec85))
* **deps:** update tods-competition-factory to 6.6.0 ([7570327](https://github.com/CourtHive/competition-factory-server/commit/7570327102fbaf0f1c0e111b07fdd2a80ead42f5))
* **deps:** update tods-competition-factory to 6.7.0 ([4014c25](https://github.com/CourtHive/competition-factory-server/commit/4014c25e515b5059ebed7e6977492ba83f3303cc))

## [1.1.3](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.1.2...audit-worker-v1.1.3) (2026-07-06)


### Bug Fixes

* **deps:** keep audit-worker on tods-competition-factory 5.9.0 (defer 6.x migration) ([5cf25e9](https://github.com/CourtHive/competition-factory-server/commit/5cf25e99720a7b7f2bbcc6bbe7c5f239746ac860))
* **deps:** migrate audit-worker to tods-competition-factory 6.1.1 ([1625d86](https://github.com/CourtHive/competition-factory-server/commit/1625d86abe4d20c0a4a09faaddacc5df89236c58))
* **deps:** update tods-competition-factory to 6.2.0 ([4dbcbf4](https://github.com/CourtHive/competition-factory-server/commit/4dbcbf48519e7db7438425e91d9bdee9de9b1143))
* **deps:** update tods-competition-factory to 6.3.0 ([698850d](https://github.com/CourtHive/competition-factory-server/commit/698850d91ef3cbb3b51d93e67893ca1984fc8875))

## [1.1.2](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.1.1...audit-worker-v1.1.2) (2026-06-30)


### Bug Fixes

* **deps:** bump audit-worker tods-competition-factory to 5.9.0 ([8c88c6a](https://github.com/CourtHive/competition-factory-server/commit/8c88c6a64d12f6879db7458f4c1fe93c091325f7))

## [1.1.1](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.1.0...audit-worker-v1.1.1) (2026-06-24)


### Bug Fixes

* **deps:** update tods-competition-factory to 5.3.0 ([a1c694c](https://github.com/CourtHive/competition-factory-server/commit/a1c694ccf6d0c3041b889e150e998fb445fbbff7))
* **deps:** update tods-competition-factory to 5.4.0 ([1446058](https://github.com/CourtHive/competition-factory-server/commit/1446058ff5be7e515f69f7359fe608ed6c2f740d))
* **deps:** update tods-competition-factory to 5.6.0 ([08db54f](https://github.com/CourtHive/competition-factory-server/commit/08db54f8018f68a1540ee4714af3daa1b897241f))
* **deps:** update tods-competition-factory to 5.7.0 ([74e3929](https://github.com/CourtHive/competition-factory-server/commit/74e3929d0962f1f60e9aa8ab0d917a70a40ccaa3))

## [1.1.0](https://github.com/CourtHive/competition-factory-server/compare/audit-worker-v1.0.0...audit-worker-v1.1.0) (2026-06-03)


### Features

* **admin:** provisioner management UI + GET endpoint ([44c9530](https://github.com/CourtHive/competition-factory-server/commit/44c95303d8044667b1b38e27f000c4b283bf17d7))
* audit condensation worker with 4 condensers ([23846ac](https://github.com/CourtHive/competition-factory-server/commit/23846aceabc086b113c8e2407690cc5d4f43cb48))
* **auth:** provider-scoped admin reset + self-service change-password ([e402aee](https://github.com/CourtHive/competition-factory-server/commit/e402aee07cdbd7146dd3f529ea665a0ce8d2b126))
* save validation worker — async holding pen for /factory/save ([551453a](https://github.com/CourtHive/competition-factory-server/commit/551453ad6087a737fc522afc49da2fd57217e84f))


### Bug Fixes

* **audit-worker:** replace axios with native fetch to stop Socket listener leak ([5e9bc81](https://github.com/CourtHive/competition-factory-server/commit/5e9bc8190a953527459193dfb3e3c82ea51b3ee1))
* **deps:** update dependency tods-competition-factory to v4.0.0 ([5bf7c71](https://github.com/CourtHive/competition-factory-server/commit/5bf7c71f40e85972e9aeda7fc50dee558d07cdce))
* exclude __tests__ from audit-worker tsc build ([9308f98](https://github.com/CourtHive/competition-factory-server/commit/9308f98a0e28a043e8e3405ee87f1450aeb17982))
* **sub-packages:** add pnpm.onlyBuiltDependencies to admin-client + audit-worker ([70c094d](https://github.com/CourtHive/competition-factory-server/commit/70c094da9f6c0ae65e67279ae42d8c33afd1c8d4))
* **sub-packages:** give admin-client + audit-worker their own .npmrc + workspace.yaml ([f383a03](https://github.com/CourtHive/competition-factory-server/commit/f383a033864c5c8b7eb39a7544d8dba5cabb1397))

## 1.0.0 (2026-06-03)


### Features

* **admin:** provisioner management UI + GET endpoint ([44c9530](https://github.com/CourtHive/competition-factory-server/commit/44c95303d8044667b1b38e27f000c4b283bf17d7))
* audit condensation worker with 4 condensers ([23846ac](https://github.com/CourtHive/competition-factory-server/commit/23846aceabc086b113c8e2407690cc5d4f43cb48))
* **auth:** provider-scoped admin reset + self-service change-password ([e402aee](https://github.com/CourtHive/competition-factory-server/commit/e402aee07cdbd7146dd3f529ea665a0ce8d2b126))
* save validation worker — async holding pen for /factory/save ([551453a](https://github.com/CourtHive/competition-factory-server/commit/551453ad6087a737fc522afc49da2fd57217e84f))


### Bug Fixes

* **audit-worker:** replace axios with native fetch to stop Socket listener leak ([5e9bc81](https://github.com/CourtHive/competition-factory-server/commit/5e9bc8190a953527459193dfb3e3c82ea51b3ee1))
* **deps:** update dependency tods-competition-factory to v4.0.0 ([5bf7c71](https://github.com/CourtHive/competition-factory-server/commit/5bf7c71f40e85972e9aeda7fc50dee558d07cdce))
* exclude __tests__ from audit-worker tsc build ([9308f98](https://github.com/CourtHive/competition-factory-server/commit/9308f98a0e28a043e8e3405ee87f1450aeb17982))
* **sub-packages:** add pnpm.onlyBuiltDependencies to admin-client + audit-worker ([70c094d](https://github.com/CourtHive/competition-factory-server/commit/70c094da9f6c0ae65e67279ae42d8c33afd1c8d4))
* **sub-packages:** give admin-client + audit-worker their own .npmrc + workspace.yaml ([f383a03](https://github.com/CourtHive/competition-factory-server/commit/f383a033864c5c8b7eb39a7544d8dba5cabb1397))
