# Environment Variables Setup Guide

This document outlines all required environment variables for the Softcodes application and provides instructions for secure setup.

## Required Environment Variables

### Supabase Configuration

- `SUPABASE_URL`: Your Supabase project URL (e.g., `https://your-project.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (with full access permissions)
- `SUPABASE_ANON_KEY`: Supabase anonymous key (for client-side operations)
- `NEXT_PUBLIC_SUPABASE_URL`: Public Supabase URL (same as `SUPABASE_URL`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public Supabase anonymous key (same as `SUPABASE_ANON_KEY`)

### API Providers

- `OPENROUTER_API_KEY`: Your OpenRouter API key for AI model access
- `CLERK_SECRET_KEY`: Clerk authentication secret key
- `REQUESTY_API_KEY`: Requesty API key (if using Requesty provider)
- `GLAMA_API_KEY`: Glama API key (if using Glama provider)

### Analytics & Monitoring

- `KILOCODE_POSTHOG_API_KEY`: PostHog analytics API key for usage tracking
- `NEXT_PUBLIC_POSTHOG_KEY`: Public PostHog key for client-side analytics

### Application Configuration

- `NODE_ENV`: Environment mode (`development`, `production`, `test`)
- `PORT`: Server port (default: 3000)

## Setup Instructions

### 1. Create Environment File

Create a `.env` file in the root directory of the project:

```bash
touch .env
```

### 2. Add Environment Variables

Add the following variables to your `.env` file, replacing placeholder values with your actual credentials:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
SUPABASE_ANON_KEY=your-anon-key-here
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# API Providers
OPENROUTER_API_KEY=your-openrouter-api-key-here
CLERK_SECRET_KEY=your-clerk-secret-key-here
REQUESTY_API_KEY=your-requesty-api-key-here
GLAMA_API_KEY=your-glama-api-key-here

# Analytics
KILOCODE_POSTHOG_API_KEY=your-posthog-api-key-here
NEXT_PUBLIC_POSTHOG_KEY=your-public-posthog-key-here

# Application
NODE_ENV=development
PORT=3000
```

### 3. Security Best Practices

- **Never commit `.env` files**: Ensure `.env` is listed in your `.gitignore` file
- **Use different keys for different environments**: Maintain separate credentials for development, staging, and production
- **Rotate keys regularly**: Periodically update your API keys and secrets
- **Use secure storage**: Consider using secret management services for production environments

### 4. Environment Variable Validation

The application includes validation for required environment variables. If any required variables are missing, the system will:

1. Log warnings during startup
2. Provide fallback values where possible for development
3. Show clear error messages for missing production requirements

### 5. Testing Environment

For testing, mock values are used. The test files are configured to use test-specific credentials that don't expose production secrets.

Example test values:

```env
SUPABASE_URL=https://test.supabase.co
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
SUPABASE_ANON_KEY=test-anon-key
```

### 6. Production Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Use production-grade API keys and secrets
3. Ensure all required variables are set
4. Consider using environment-specific configuration files or cloud provider secret management

## Troubleshooting

If you encounter issues:

1. **Check variable names**: Ensure all variable names match exactly (case-sensitive)
2. **Verify values**: Confirm API keys and URLs are correct and active
3. **Restart application**: Environment variables are loaded at startup
4. **Check .gitignore**: Ensure `.env` is not being committed to version control

## Support

For assistance with environment setup, refer to:

- Supabase documentation: https://supabase.com/docs
- OpenRouter documentation: https://openrouter.ai/docs
- Clerk documentation: https://clerk.com/docs
