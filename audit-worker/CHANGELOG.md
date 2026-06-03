# Changelog

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
