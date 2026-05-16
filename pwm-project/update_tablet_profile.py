import sys

file_path = "frontend/src/app/profile/profile.page.scss"

with open(file_path, "r") as f:
    content = f.read()

media_start = content.find("@media (min-width: 768px) and (max-width: 1100px) {")

if media_start != -1:
    content_before = content[:media_start]
    
    new_media = """@media (min-width: 768px) and (max-width: 1100px) {
  .home-page {
    height: auto; min-height: 100vh; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column;
    padding-top: 80px !important; 
  }
  
  .mobile-header { 
    display: flex !important; 
    top: 15px; left: 15px; width: calc(100% - 30px); padding: 12px 25px;
  } 
  
  .mobile-header .nav-title { font-size: 1.3rem; }
  .mobile-header .back-link { font-size: 1.1rem; }
  
  .top-row {
    flex-direction: row; flex-wrap: wrap; perspective: none !important; 
    gap: 30px; padding: 20px; height: auto; justify-content: center;
  }

  .left-column, .right-column, .center-column {
    transform: none !important; flex: none; overflow: visible;
  }
  
  .left-column:hover, .right-column:hover { transform: none !important; }

  /* Il Profilo torna in testa */
  .center-column { order: 1; width: 100%; max-width: 800px; padding-bottom: 30px; margin-top: 0; }
  
  /* I due pannelli si affiancano grandissimi per iPad Pro */
  .left-column { order: 2; width: calc(50% - 15px); max-width: 600px; }
  .right-column { order: 3; width: calc(50% - 15px); max-width: 600px; }
  
  /* Ingrandiamo notevolmente la zona Profilo e Azioni */
  .title-block {
    .eyebrow { font-size: 0.9rem; }
    h1 { font-size: 3rem; }
  }
  .avatar-core .avatar-frame { width: 180px; height: 180px; }
  .avatar-core .elo-badge h2 { font-size: 2.2rem; }
  .avatar-core .elo-badge p { font-size: 0.8rem; }
  
  .action-dock { max-width: 500px; margin: 30px auto 0; }
  .primary-glow { font-size: 1rem !important; padding: 18px 20px !important; }
  
  /* Ingrandiamo i vecchi pannelli striminziti */
  .panel-heading span { font-size: 1rem; }
  .panel-heading small { font-size: 0.75rem; }
  .data-value { font-size: 1rem; }
  .field-container .custom-label { font-size: 0.75rem; }
  .chart-container { height: 100px; }
  .bar-label { font-size: 0.7rem; }
  .radial-container .chart-wrap { width: 80px; height: 80px; }
  .radial-container .text-wrap h3 { font-size: 1.4rem; }
  .kd-container .kd-labels { font-size: 0.85rem; }
  
  .standard-btn, .logout-button { font-size: 0.9rem; padding: 15px; }

  .hud-footer {
    width: calc(100% - 32px) !important; margin: 40px auto 20px auto !important; padding: 12px 20px;
    &-content { flex-direction: row; text-align: center; font-size: 0.75rem; justify-content: space-between; }
  }
}

/* MOBILE (< 768px) */
@media (max-width: 767px) {
  .home-page {
    height: auto; min-height: 100vh; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column;
    padding-top: 75px !important; 
  }
  
  .mobile-header { display: flex !important; } 
  
  .top-row {
    flex-direction: column; perspective: none !important; gap: 20px; padding: 10px; height: auto;
  }

  .left-column, .right-column, .center-column {
    transform: none !important; width: 100%; max-width: 500px; flex: none; overflow: visible;
  }
  
  .left-column:hover, .right-column:hover { transform: none !important; }

  .center-column { order: -1; width: 100%; max-width: 500px; margin-top: 0; padding-bottom: 10px; }
  
  .hud-footer { margin: 20px auto 20px auto !important; }
  
  .hud-footer-content { flex-direction: column; gap: 6px; text-align: center; }
  .footer-left, .footer-center, .footer-right { font-size: 0.55rem; white-space: normal; }
  .divider { display: none; }
}
"""
    with open(file_path, "w") as f:
        f.write(content_before + new_media)
        
    print("Profile page responsive rules updated")
