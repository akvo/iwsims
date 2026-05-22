#!/bin/sh

# Set default APP_NAME if not provided
export APP_NAME=${APP_NAME:-iwsims}
echo "Starting development server with APP_NAME: ${APP_NAME}"

# Create .env file with environment variables
echo "PUBLIC_URL=/" > .env
echo "APP_NAME=${APP_NAME}" >> .env

# Put APP_NAME into frontend/public/index.html
sed -i "s|<title>.*</title>|<title>${APP_NAME}</title>|" public/index.html

# Put APP_NAME into frontend/public/manifest.json
sed -i "s|\"name\": \".*\"|\"name\": \"${APP_NAME}\"|" public/manifest.json

# Put APP_SHORT_NAME into frontend/public/manifest.json
sed -i "s|\"short_name\": \".*\"|\"short_name\": \"${APP_SHORT_NAME}\"|" public/manifest.json

yarn install
yarn start
