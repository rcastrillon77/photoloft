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
        // Remove .open from all amenities and their cross-icons
        document.querySelectorAll(".amenity").forEach(el => {
          el.classList.remove("open");
          const icon = el.querySelector(".cross-icon");
          if (icon) icon.classList.remove("open");
        });
  
        // Add .open to the clicked .amenity and its .cross-icon
        const amenity = title.closest(".amenity");
        const icon = title.querySelector(".cross-icon");
        if (amenity) amenity.classList.add("open");
        if (icon) icon.classList.add("open");
      });
    });
  });
  