#!/bin/bash

# Pyronear Annotation API - Setup Script
# This script handles initial setup tasks for the annotation API

set -e  # Exit on any error

echo "🔧 Setting up Pyronear Annotation API..."

# Function to create acme.json file if it doesn't exist
setup_acme_file() {
    local acme_file="./acme.json"
    
    if [ ! -f "$acme_file" ]; then
        echo "📄 Creating acme.json file for Let's Encrypt certificates..."
        touch "$acme_file"
        chmod 600 "$acme_file"
        echo "✅ Created $acme_file with proper permissions (600)"
    else
        echo "✅ acme.json already exists"
        # Ensure correct permissions even if file exists
        chmod 600 "$acme_file"
        echo "✅ Verified acme.json permissions (600)"
    fi
}

# Function to check if required tools are installed
check_prerequisites() {
    echo "🔍 Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker is not installed. Please install Docker first."
        echo "   See: https://docs.docker.com/engine/install/"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        echo "❌ Docker Compose is not installed. Please install Docker Compose first."
        echo "   See: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    echo "✅ Prerequisites check passed"
}

# Main setup function
main() {
    echo "🚀 Starting setup process..."
    
    check_prerequisites
    setup_acme_file
    
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "  - For development: make start"
    echo "  - For production: make start-prod"
    echo "  - Run tests: make test"
    echo ""
    echo "API will be available at: http://localhost:5050/docs"
}

# Run main function
main "$@"