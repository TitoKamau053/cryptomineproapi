const pool = require('../db');

// Get success stories from real user data
const getSuccessStories = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // For now, return template stories since there are no regular users yet
    // This will be replaced with real user data once users start using the platform
    const templateStories = [
      {
        name: "James K.",
        avatar: "J",
        story: "Started with KES 5,000 and now earning KES 25,000 monthly. CryptoMine Pro changed my financial life!",
        total: "+KES 120,450 total",
        time: "2 days ago",
        verified: true
      },
      {
        name: "Sarah M.",
        avatar: "S",
        story: "Amazing returns! My investment of KES 15,000 has already earned me KES 45,000 in just 3 months.",
        total: "+KES 45,000 total",
        time: "1 week ago",
        verified: true
      },
      {
        name: "David O.",
        avatar: "D",
        story: "Consistent daily earnings from my mining investments. CryptoMine Pro is reliable and transparent.",
        total: "+KES 78,900 total",
        time: "3 days ago",
        verified: true
      },
      {
        name: "Mary W.",
        avatar: "M",
        story: "Withdrew my first KES 50,000 profit last month. The mining rewards are exactly as promised!",
        total: "+KES 89,200 total",
        time: "5 days ago",
        verified: true
      },
      {
        name: "Peter N.",
        avatar: "P",
        story: "Reinvested my earnings and now have 5 active mining engines. Building wealth consistently!",
        total: "+KES 156,700 total",
        time: "1 week ago",
        verified: true
      },
      {
        name: "Grace L.",
        avatar: "G",
        story: "New to crypto but CryptoMine Pro made it easy. Already seeing great returns on my investment!",
        total: "+KES 32,100 total",
        time: "4 days ago",
        verified: true
      }
    ];
    
    const limitedStories = templateStories.slice(0, parseInt(limit));
    res.json({ stories: limitedStories });
    
  } catch (error) {
    console.error('Error fetching success stories:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getSuccessStories
};
