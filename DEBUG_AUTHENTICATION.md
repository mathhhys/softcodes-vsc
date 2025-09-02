# Authentication Debugging Plan

## 🔍 **Current Issue Analysis**

The VSCode extension is configured to communicate with your website but they can't talk to each other because:

1. **URLs Updated**: VSCode now points to `https://blue-byte-booster.vercel.app`
2. **Missing Endpoints**: Website doesn't have VSCode auth endpoints
3. **Different Clerk Instances**: Extension uses different Clerk than website

## 🧪 **Step-by-Step Debugging**

### **TEST 1: Verify Basic Connectivity (2 minutes)**

Open browser and test these URLs:

```bash
# Should work (your website)
https://blue-byte-booster.vercel.app

# Should return 404 (missing endpoints)
https://blue-byte-booster.vercel.app/extension/sign-in
https://blue-byte-booster.vercel.app/api/extension/auth/callback
```

**Expected Result**: First URL works, others return 404

### **TEST 2: Test VSCode Extension Login Flow (3 minutes)**

1. Open VSCode with your extension
2. Try to login/authenticate
3. Check VSCode Developer Console for errors:
    - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows)
    - Type "Developer: Toggle Developer Tools"
    - Look for network errors in Console tab

**Expected Error**: `Failed to fetch` or `404 Not Found` for `https://blue-byte-booster.vercel.app/extension/sign-in`

### **TEST 3: Check Current Configuration**

Run in VSCode extension debug console:

```javascript
console.log("Clerk URL:", "https://rested-mouse-99.clerk.accounts.dev")
console.log("API URL:", "https://blue-byte-booster.vercel.app")
```

## 🚀 **Quick Fix Implementation**

### **STEP 1: Add Missing Endpoints to Website**

Create these files in your `blue-byte-booster` repository:

#### **File: `src/pages/extension/sign-in.tsx`**

```typescript
import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function ExtensionSignIn() {
  const router = useRouter()

  useEffect(() => {
    const { state, auth_redirect, client_type } = router.query

    if (client_type === 'vscode_extension') {
      // For now, just redirect to your main sign-in page
      // Later we'll implement proper VSCode OAuth flow
      router.push('/sign-in')
    }
  }, [router.query])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">VSCode Extension Authentication</h1>
        <p>Redirecting to sign-in...</p>
      </div>
    </div>
  )
}
```

#### **File: `src/pages/api/extension/auth/callback.ts`**

```typescript
import { NextApiRequest, NextApiResponse } from "next"

export default function handler(req: NextApiRequest, res: NextApiResponse) {
	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" })
	}

	const { code, grant_type } = req.body

	// For now, return a mock response to test connectivity
	// Later we'll implement proper Clerk integration
	console.log("VSCode auth callback received:", { code, grant_type })

	res.status(200).json({
		access_token: "mock_token_for_testing",
		session_id: "mock_session_123",
		organization_id: null,
		user: {
			id: "mock_user_id",
			email: "test@example.com",
			name: "Test User",
		},
	})
}
```

### **STEP 2: Test the Fix**

1. Deploy changes to Vercel
2. Test URLs again:
    ```bash
    https://blue-byte-booster.vercel.app/extension/sign-in
    https://blue-byte-booster.vercel.app/api/extension/auth/callback
    ```
3. Try VSCode extension login again

### **STEP 3: Enable Logging for Debugging**

Add this to VSCode extension for debugging:

#### **File: `DEBUG_AUTH.md` (create in VSCode extension)**

```markdown
# Debug VSCode Authentication

## Enable Debug Logging

1. Open VSCode Settings
2. Search for "softcodes"
3. Enable debug logging
4. Try authentication
5. Check VSCode Developer Tools Console for detailed logs

## Common Issues

- **404 Error**: Website endpoints missing (fixed above)
- **CORS Error**: Need to configure CORS on website
- **Clerk Error**: Different Clerk instances (need to unify)
```

## 🎯 **Next Steps After Basic Connectivity Works**

Once the above steps resolve the 404 errors:

1. **Unify Clerk Instances**:

    - Use website's Clerk instance for VSCode
    - Configure OAuth app in Clerk dashboard
    - Add VSCode redirect URI: `vscode://softcodes.softcodes`

2. **Implement Real Authentication**:

    - Replace mock responses with real Clerk integration
    - Add Supabase user sync
    - Handle proper error cases

3. **Test End-to-End Flow**:
    - VSCode login → Website auth → Callback → User created in Supabase

## 🚨 **If Still Not Working**

Check these common issues:

1. **Vercel Deployment**: Ensure changes are deployed
2. **CORS Issues**: May need to configure CORS headers
3. **Clerk Configuration**: Verify Clerk keys are correct
4. **Network Issues**: Test from different networks

## 📞 **Quick Test Commands**

```bash
# Test website connectivity
curl https://blue-byte-booster.vercel.app

# Test auth endpoints (after implementing)
curl https://blue-byte-booster.vercel.app/extension/sign-in
curl -X POST https://blue-byte-booster.vercel.app/api/extension/auth/callback \
  -H "Content-Type: application/json" \
  -d '{"code":"test","grant_type":"authorization_code"}'
```

This should resolve the immediate connectivity issues and allow you to test the basic flow.
