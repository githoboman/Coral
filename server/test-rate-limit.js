
const userId = "0x" + "2".repeat(64); // Different test user
const url = "http://localhost:3000/api/chat";

async function run() {
  console.log(`Testing rate limit for user: ${userId}`);

  for (let i = 1; i <= 3; i++) {
    try {
      console.log(`\n--- Request ${i} ---`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          agentId: "task",
          message: `Rate limit test message ${i}`
        })
      });

      console.log(`Status: ${response.status}`);

      if (response.ok) {
        // Log a bit of the stream to confirm it worked
        const text = await response.text();
        console.log(`Response length: ${text.length}`);
      } else {
        const error = await response.json();
        console.log(`Error:`, error);
      }
    } catch (err) {
      console.error(`Request failed:`, err.message);
    }

    // Wait a bit properly
    await new Promise(r => setTimeout(r, 1000));
  }
}

run();
