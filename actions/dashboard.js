"use server"; // Enforces that this module is executed in a server-side environment

import aj from "@/lib/arcjet"; // Importing ArcJet for rate limiting and security
import { db } from "@/lib/prisma"; // Importing Prisma database instance for database operations
import { request } from "@arcjet/next"; // Importing request handler from ArcJet for rate limiting
import { auth } from "@clerk/nextjs/server"; // Importing authentication handler from Clerk
import { revalidatePath } from "next/cache"; // Importing function to revalidate cached paths in Next.js

// Function to serialize transaction objects by converting balance and amount to numbers
const serializeTransaction = (obj) => {
  const serialized = { ...obj }; // Create a shallow copy of the object
  if (obj.balance) {
    serialized.balance = obj.balance.toNumber(); // Convert balance from BigInt to Number
  }
  if (obj.amount) {
    serialized.amount = obj.amount.toNumber(); // Convert amount from BigInt to Number
  }
  return serialized; // Return the serialized object
};

// Function to fetch user accounts
export async function getUserAccounts() {
  const { userId } = await auth(); // Authenticate user and get user ID
  if (!userId) throw new Error("Unauthorized"); // Throw error if user is not authenticated

  const user = await db.user.findUnique({
    where: { clerkUserId: userId }, // Find user in database using Clerk's user ID
  });

  if (!user) {
    throw new Error("User not found"); // Throw error if user does not exist in database
  }

  try {
    const accounts = await db.account.findMany({
      where: { userId: user.id }, // Fetch all accounts associated with the user
      orderBy: { createdAt: "desc" }, // Order accounts by creation date (newest first)
      include: {
        _count: {
          select: {
            transactions: true, // Include transaction count for each account
          },
        },
      },
    });

    // Serialize accounts before sending to client
    const serializedAccounts = accounts.map(serializeTransaction);

    return serializedAccounts; // Return serialized account data
  } catch (error) {
    console.error(error.message); // Log error message if database query fails
  }
}

// Function to create a new user account
export async function createAccount(data) {
  try {
    const { userId } = await auth(); // Authenticate user and get user ID
    if (!userId) throw new Error("Unauthorized"); // Throw error if user is not authenticated

    const req = await request(); // Get request data for ArcJet

    // Check rate limit using ArcJet
    const decision = await aj.protect(req, {
      userId,
      requested: 1, // Specify how many tokens to consume for rate limiting
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) { // If rate limit is exceeded
        const { remaining, reset } = decision.reason;
        console.error({
          code: "RATE_LIMIT_EXCEEDED",
          details: {
            remaining, // Number of remaining requests
            resetInSeconds: reset, // Time in seconds before reset
          },
        });
        throw new Error("Too many requests. Please try again later."); // Inform user about rate limit
      }
      throw new Error("Request blocked"); // Block other denied requests
    }

    const user = await db.user.findUnique({
      where: { clerkUserId: userId }, // Find user in database
    });

    if (!user) {
      throw new Error("User not found"); // Throw error if user does not exist
    }

    // Convert balance to float before saving
    const balanceFloat = parseFloat(data.balance);
    if (isNaN(balanceFloat)) {
      throw new Error("Invalid balance amount"); // Ensure balance is a valid number
    }

    // Check if this is the user's first account
    const existingAccounts = await db.account.findMany({
      where: { userId: user.id },
    });

    // Determine if this account should be default
    const shouldBeDefault = existingAccounts.length === 0 ? true : data.isDefault;

    // If this account should be default, unset other default accounts
    if (shouldBeDefault) {
      await db.account.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false }, // Unset other default accounts
      });
    }

    // Create new account in database
    const account = await db.account.create({
      data: {
        ...data,
        balance: balanceFloat, // Store balance as a float
        userId: user.id, // Associate account with user
        isDefault: shouldBeDefault, // Override default status based on logic
      },
    });

    // Serialize the account before returning
    const serializedAccount = serializeTransaction(account);

    revalidatePath("/dashboard"); // Revalidate dashboard cache to reflect changes
    return { success: true, data: serializedAccount }; // Return success response with account data
  } catch (error) {
    throw new Error(error.message); // Handle and throw any errors
  }
}

// Function to fetch user dashboard data
export async function getDashboardData() {
  const { userId } = await auth(); // Authenticate user and get user ID
  if (!userId) throw new Error("Unauthorized"); // Throw error if user is not authenticated

  const user = await db.user.findUnique({
    where: { clerkUserId: userId }, // Find user in database
  });

  if (!user) {
    throw new Error("User not found"); // Throw error if user does not exist
  }

  // Get all transactions related to the user
  const transactions = await db.transaction.findMany({
    where: { userId: user.id },
    orderBy: { date: "desc" }, // Order transactions by date (newest first)
  });

  return transactions.map(serializeTransaction); // Serialize transactions before returning
}