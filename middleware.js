// Import necessary modules and functions from Arcjet and Clerk
import arcjet, { createMiddleware, detectBot, shield } from "@arcjet/next";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define a route matcher for protected routes
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)", // Matches any route under /dashboard
  "/account(.*)", // Matches any route under /account
  "/transaction(.*)", // Matches any route under /transaction
]);

// Create Arcjet middleware configuration
const aj = arcjet({
  key: process.env.ARCJET_KEY, // Use the Arcjet key from environment variables
  // characteristics: ["userId"], // Optional: Track based on Clerk userId
  rules: [
    // Add shield protection for content and security
    shield({
      mode: "LIVE", // Enable live mode for real-time protection
    }),
    // Detect and handle bot traffic
    detectBot({
      mode: "LIVE", // Block requests in live mode; use "DRY_RUN" to log only
      allow: [
        "CATEGORY:SEARCH_ENGINE", // Allow search engine bots like Google, Bing, etc.
        "GO_HTTP", // Allow Inngest bot
        // Additional allowed bots can be found at the provided URL
      ],
    }),
  ],
});

// Create base Clerk middleware
const clerk = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth(); // Authenticate the user and get the userId

  // If the user is not authenticated and the route is protected
  if (!userId && isProtectedRoute(req)) {
    const { redirectToSignIn } = await auth(); // Get the sign-in redirect URL
    return redirectToSignIn(); // Redirect unauthenticated users to sign-in
  }

  return NextResponse.next(); // Proceed to the next middleware or route handler
});

// Chain middlewares - ArcJet runs first, then Clerk
export default createMiddleware(aj, clerk);

// Configuration for the middleware matcher
export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};