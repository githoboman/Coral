import axios from 'axios';
import { getBlockVisionService } from './blockVisionService';

// Mock axios to simulate BlockVision failure
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

async function testFallback() {
  console.log("--- Starting BlockVision Fallback Test ---");
  const service = getBlockVisionService();

  // 1. Simulate 429 Error
  console.log("\n1. Simulating 429 Too Many Requests...");
  mockedAxios.get.mockRejectedValueOnce({
    response: { status: 429, data: { message: "Rate limit exceeded" } }
  });

  try {
    await service.getAccountPortfolio("0x123");
    console.log("SUCCESS: Fallback handled the initial 429.");
  } catch (err) {
    console.error("FAILURE: Initial 429 was not caught by fallback.", err);
  }

  // 2. Subsequent call should bypass BlockVision immediately
  console.log("\n2. Verification: Subsequent call should bypass BlockVision...");
  // If bypass works, axios.get should NOT be called again for BlockVision
  const callCountBefore = mockedAxios.get.mock.calls.length;

  try {
    await service.getAccountPortfolio("0x123");
    const callCountAfter = mockedAxios.get.mock.calls.length;

    if (callCountAfter === callCountBefore) {
      console.log("SUCCESS: Circuit breaker active. BlockVision bypassed.");
    } else {
      console.error("FAILURE: Circuit breaker failed. BlockVision was called again.");
    }
  } catch (err) {
    console.error("FAILURE: Subsequent call failed.", err);
  }

  console.log("\n--- Test Complete ---");
}

// Note: This script is intended to be run in a test environment with jest
// Since I cannot easily run jest here, I will perform a manual verification
// via logs if possible, or provide this script for user reference.
