const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function run() {
    const containers = await docker.listContainers();
    if (containers.length > 0) {
        console.log("From listContainers:");
        console.log("Names:", containers[0].Names);
        console.log("Labels:", containers[0].Labels);
        
        const inspect = await docker.getContainer(containers[0].Id).inspect();
        console.log("From inspect:");
        console.log("Name:", inspect.Name);
        console.log("Names:", inspect.Names);
        console.log("Labels:", inspect.Labels);
        console.log("Config.Labels:", inspect.Config ? inspect.Config.Labels : undefined);
    }
}
run();
