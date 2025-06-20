// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);
});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    console.log("🧪 Triggering test pre-booking flow...");
  
    const dummyBooking = {
      uuid: "test-booking-uuid",
      start: DateTime.now().toISO(),
      end: DateTime.now().plus({ hours: 1 }).toISO(),
      entry_code: "0752",
      listing: {
        name: "Light Loft"
      },
      user: {
        first_name: "Test",
        last_name: "User"
      }
    };
  
    try {
      await triggerHomeSetup(dummyBooking);
      console.log("✅ Test pre-booking flow complete");
    } catch (err) {
      console.error("❌ Test flow failed:", err);
    }
  });
  