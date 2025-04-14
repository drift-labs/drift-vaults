# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Features

* program: introduce `FeeUpdate` account to allow raising vault fees behind a time lock ([#87](https://github.com/drift-labs/drift-vaults/pull/87))

### Fixes

### Breaking

## [0.6.0] - 2024-03-20

### Features

* program: implement hurdle rate ([#76](https://github.com/drift-labs/drift-vaults/pull/76))
* add `deposit_oracle_price` to `VaultDepositorRecord` and `VaultDepositorV1Record` ([#80](https://github.com/drift-labs/drift-vaults/pull/80))
* add `update_vault_manager` instruction, refactor sdk for multisig support ([#81](https://github.com/drift-labs/drift-vaults/pull/81))
* program: clamp user deposit amount to room available ([#82](https://github.com/drift-labs/drift-vaults/pull/82))

### Fixes

### Breaking

## [0.5.0] - 2024-03-03

### Features

* program: apply rebase to manager withdrawal if present ([#74](https://github.com/drift-labs/drift-vaults/pull/74))
* program: update pool id ([#73](https://github.com/drift-labs/drift-vaults/pull/73))
* auto distribute fuel to vault depositors ([#64](https://github.com/drift-labs/drift-vaults/pull/64))

### Fixes

### Breaking

## [0.4.0] - 2024-02-11

### Features

* update drift to v2.109.0

### Fixes

### Breaking

## [0.3.0] - 2024-01-25

* audit fixes

### Features

### Fixes

### Breaking

## [0.2.0] - 2024-12-10

### Features

* update drift to v2.103.0
* Tokenized Vaults ([#55](https://github.com/drift-labs/drift-vaults/pull/55))
* Remove drift-competitions ([#56](https://github.com/drift-labs/drift-vaults/pull/56))
* Add IF functions ([#57](https://github.com/drift-labs/drift-vaults/pull/57))

### Fixes

### Breaking
