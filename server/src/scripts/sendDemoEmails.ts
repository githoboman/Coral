
import { getEmailService } from "../services/emailService";
import dotenv from "dotenv";

dotenv.config();

const emailService = getEmailService();
const TO_EMAIL = "mesalokubor@gmail.com";
const USERNAME = "Mesal"; // Demo username

// --- Helper Functions ---
function formatDate(dateStr?: string): string {
  if (!dateStr) return "ASAP";
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function sendDemo() {
  console.log(`Sending demo emails to ${TO_EMAIL}...`);

  // 1. New Task Notification
  const taskName1 = "Review Smart Contract Implementation";
  const desc1 = "Go through the `UserManager.move` code and ensure access controls are correct.";
  const dueDate1 = new Date(Date.now() + 86400000).toISOString(); // Tomorrow
  const priority1 = "High";

  const htmlNewTask = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <p>Hey <b>${USERNAME}</b>,</p>
            <p>You just created a new task!</p>
            
            <p>Here's the <b>Details</b></p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
              <p style="font-weight: bold; margin-top: 0;">${taskName1}</p>
              <p>${desc1}</p>
            </div>

            <p><b>Due Date</b><br>${new Date(dueDate1).toLocaleString("en-US", {
    month: "numeric", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit"
  })}</p>

            <p><b>Priority</b><br>${priority1}</p>

            <p>I'd be here to remind you once it is due.</p>
            <p>Thanks,<br>Tovira Team</p>
        </div>
        `;

  await emailService.sendEmail(TO_EMAIL, `New Notification!`, htmlNewTask);
  console.log("✅ Sent 'New Notification!' demo.");

  // 2. Reminder Notification
  const taskName2 = "Submit Project Proposal";
  const desc2 = "Finalize the PDF and upload it to the portal before deadline.";
  const dueDate2 = new Date().toISOString(); // Today

  const htmlReminder = `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <p>Hey <b>${USERNAME}</b>,</p>
            <p>Your task is due! Kindly attend to it.</p>
            
            <p>Here's the <b>details of what you asked me to remind you</b></p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 10px 0;">
              <p style="font-weight: bold; margin-top: 0;">${taskName2}</p>
              <p>${desc2}</p>
            </div>

            <p><b>Due Date</b><br>${formatDate(dueDate2)}</p>

            <p>Do well to schedule more activities, I look forward to helping you stay productive.</p>
            <p>Thanks,<br>Tovira Team</p>
        </div>
        `;

  await emailService.sendEmail(TO_EMAIL, `Reminder Alert!!`, htmlReminder);
  console.log("✅ Sent 'Reminder Alert!!' demo.");
}

sendDemo().catch(console.error);
