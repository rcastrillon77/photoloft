// =======================
// INIT
// =======================

document.addEventListener("DOMContentLoaded", async () => {
    console.log("🟢 Studio control panel script loaded");
    await refreshBookingData();
    scheduleQuarterHourUpdates(refreshBookingData);

    if (window.currentBookingUUID) {
      await rebuildBookingDetails(window.currentBookingUUID);
      await initBookingConfig(LISTING_UUID);
      populateReservationDetails(window.details);
      applyActionButtonStates(window.details);
    }

});
  
document.getElementById("test-trigger")?.addEventListener("click", async () => {
    await triggerLockCode("0752", "Light Loft");
});
  
// AMENITIES ACCORDION
document.addEventListener("DOMContentLoaded", () => {
    // Remove .open from all amenities on page load
    document.querySelectorAll(".amenity").forEach(el => {
      el.classList.remove("open");
      const icon = el.querySelector(".cross-icon");
      if (icon) icon.classList.remove("open");
    });
  
    // Add click listener to each .amenity_title
    document.querySelectorAll(".amenity_title").forEach(title => {
      title.addEventListener("click", () => {
        const amenity = title.closest(".amenity");
        const isOpen = amenity.classList.contains("open");
  
        // Remove .open from all amenities and icons
        document.querySelectorAll(".amenity").forEach(el => {
          el.classList.remove("open");
          const icon = el.querySelector(".cross-icon");
          if (icon) icon.classList.remove("open");
        });
  
        // If it was not already open, open it
        if (!isOpen) {
          amenity.classList.add("open");
          const icon = title.querySelector(".cross-icon");
          if (icon) icon.classList.add("open");
        }
      });
    });
});

// ADD TIME
document.getElementById("actions_add-time")?.addEventListener("click", async () => {
  showPopupById("add-time-popup");
  await setupRescheduleFlow(window.details);
});
  