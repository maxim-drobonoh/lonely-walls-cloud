#!/bin/bash

cp ./src/config/config_dev.ts ./src/config.ts
echo "config_dev copy"

firebase logout
firebase login
firebase use lonelywalls-maxylogic
