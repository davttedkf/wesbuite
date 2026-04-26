
document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.getElementById('cursorTrail');
    
    // 1. Make the basic "Magic Wand" cursor follow the mouse
    document.addEventListener('mousemove', (e) => {
        // Position our custom cursor where the real one is
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
        
        // 2. Add the sparkle trail effect
        createSparkle(e.clientX, e.clientY);
    });
});

// Create one sparkle particle
function createSparkle(x, y) {
    const particle = document.createElement('div');
    particle.className = 'sparkle-particle';
    
    // Add minor variation in position for the trail
    const randomX = x + (Math.random() - 0.5) * 10;
    const randomY = y + (Math.random() - 0.5) * 10;
    
    particle.style.left = `${randomX}px`;
    particle.style.top = `${randomY}px`;
    
    // Set a random rainbow-ish color
    const colors = ['#BA68C8', '#FF8A80', '#FFE082', '#90CAF9'];
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    
    // Add to body and remove automatically after animation
    document.body.appendChild(particle);
    
    setTimeout(() => {
        particle.remove();
    }, 500); // Must match the CSS animation duration
}
