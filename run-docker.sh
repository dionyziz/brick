#!/bin/bash
docker run -d -p 8545:8545 trufflesuite/ganache-cli:latest --networkId 5474343 --accounts 100 --mnemonic 'attack guess know manual soap original panel cabbage firm horn whale party'
