// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);
});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    console.log("🧪 Triggering full snapshot flow via Nabu Casa");
  
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
        const res = await fetch(HA_WEBHOOK_SNAPSHOT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            booking_uuid: dummyBooking.uuid,
            booking_start: dummyBooking.start
            })
        });
    
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log("✅ Snapshot flow successfully triggered");
    } catch (err) {
        console.error("❌ Snapshot webhook failed:", err);
    }
});
  