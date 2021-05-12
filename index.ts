import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();

// Create main VPC
const vpc = new awsx.ec2.Vpc("reguleque-vpc", {});
export const vpcId = vpc.id;
export const vpcPrivateSubnetIds = vpc.privateSubnetIds;
export const vpcPublicSubnetIds = vpc.publicSubnetIds;

// Create corresponding security group
const sg = new awsx.ec2.SecurityGroup("reguleque-sg", { vpc });

// Inbound HTTP traffic to the LB
sg.createIngressRule("http-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.TcpPorts(80),
    description: "allow HTTP access from anywhere",
})
// Inbound HTTPS traffic to the LB
sg.createIngressRule("https-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.TcpPorts(443),
    description: "allow HTTPS access from anywhere",
})
// Outbound TCP traffic on any port to anywhere
sg.createEgressRule("outbound-access", {
    location: new awsx.ec2.AnyIPv4Location(),
    ports: new awsx.ec2.AllTcpPorts(),
    description: "allow outbound access to anywhere",
});

// Create a load balancer with a custom Target Group using the /health endpoint for health checks to Typesense (this automates healing on the load balancer).
const alb = new awsx.lb.ApplicationLoadBalancer("typesense-lb", {
    vpc: vpc
});
const tg = alb.createTargetGroup("typesense-tg", {
    port: 80,
    protocol: "HTTP",
    healthCheck: {
        path: "/health"
    }
})
// Add the listener, this routes the requests to the containers we're going to create.
const lbl = tg.createListener("typesense-lb", { port: 80 });

// Create a cluster for the containers
const cluster = new awsx.ecs.Cluster("reguleque-cl", {
    vpc,
    securityGroups: [sg],
    tags: {
        "Name": "reguleque",
    },
});


// Define the cluster task and service, building and publishing our "./app/Dockerfile" and connecting to the listener.
const adminApiKey = config.require("adminApiKey");
// Create a EFS volume for persistence
const filesystem = new aws.efs.FileSystem("typesense-fs");
const ap = new aws.efs.AccessPoint("typesense-fs-as", {
    fileSystemId: filesystem.id,
})
const typesenseTask = new awsx.ecs.FargateTaskDefinition
    ("typesense-ta", {
        containers: {
            typesense: {
                // Build the image from the Dockerfile
                image: awsx.ecs.Image.fromPath("typesense", "./app"),
                // This container is a requisite for the entire task
                essential: true,
                // Pass the administrator API key secret from the config
                command: [`--api-key=${adminApiKey}`],
                // Requirements
                cpu: 2,
                memory: 512,
                // Connect with the load balancer listener
                portMappings: [lbl],
                // Mount a persistent volume for the typesense database
                mountPoints: [
                    {
                        sourceVolume: "typesense-storage",
                        containerPath: "/data"
                    }
                ]
            },
        },
        // Create the volume needed for /data
        // Note that sharing this between typesense instances has NOT been tested
        volumes: [
            {
                name: "typesense-storage",
                efsVolumeConfiguration: {
                    fileSystemId: filesystem.id,
                    transitEncryption: "ENABLED",
                    authorizationConfig: {
                        accessPointId: ap.id,
                        iam: "ENABLED",
                    },
                }
            }
        ]
    })
// Create the service with only one instance in the cluster
// Scaling has NOT been tested yet.
const typesenseService = typesenseTask.createService("typesense-se", {
    cluster,
    desiredCount: 1,
});

// Export the URL so we can easily access it.
export const apiURL = pulumi.interpolate`http://${lbl.endpoint.hostname}/`;
