#!/bin/bash

cp ./src/config/config_prod.ts ./src/config.ts
echo "config_prod copy"

firebase logout
firebase login
firebase use lonely-walls-corp
