
const Venom = {
    async close_connection(){},
    async poison_connection(){},
    async abort_connection(){},
    async monitor_connection(){},
    async kill_connection(){},
    async log_connection(){},
    async analyze_connection(){},
    async quarantine_connection(){},
    async alert_admin(){},
    async block_ip(ip){},
    async block_user(user){},
    async block_device(device){},
    async block_region(region){},
    async block_network(network){},
}

module.exports = Venom;