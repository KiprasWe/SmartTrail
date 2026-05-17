import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DATABASE_URL, isDevelopment } from "./env.js";

const adapter = new PrismaPg({ connectionString: DATABASE_URL });

const prisma = new PrismaClient({
  log: isDevelopment() ? ["query", "error", "warn"] : ["error"],
  adapter,
});

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("DB Connected via Prisma");
  } catch (error) {
    console.error("DB Connection Error:", error);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
};

export { prisma, connectDB, disconnectDB };
