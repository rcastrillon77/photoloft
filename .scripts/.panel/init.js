// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);
});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    await triggerLockCode("0752", "Light Loft");
});
  