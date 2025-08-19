#!/bin/bash

# Pyronear Annotation API - Setup Script
# This script handles initial setup tasks for the annotation API

set -e  # Exit on any error

echo "🔧 Setting up Pyronear Annotation API..."


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
    
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "  - For development: make start"
    echo "  - Run tests: make test"
    echo ""
    echo "API will be available at: http://localhost:5050/docs"
}

# Run main function
main "$@"
